package main

import (
	   "encoding/json"
	   "fmt"
	   "syscall/js"
	   "time"

	   "github.com/redpanda-data/benthos/v4/public/bloblang"
	   "github.com/redpanda-data/benthos/v4/public/service"
	   _ "github.com/redpanda-data/connect/v4/public/components/pure/extended"
)

// containsJsonNumber recursively checks for json.Number in a structure.
// Returns true and the path if found. Used as a failsafe to ensure no json.Number leaks into Redpanda Connect.
func containsJsonNumber(v any, path string) (bool, string) {
	   switch val := v.(type) {
	   case map[string]interface{}:
			   // Recursively check all map values
			   for k, v2 := range val {
					   if found, p := containsJsonNumber(v2, path+"."+k); found {
							   return true, p
					   }
			   }
	   case []interface{}:
			   // Recursively check all array elements
			   for i, v2 := range val {
					   if found, p := containsJsonNumber(v2, fmt.Sprintf("%s[%d]", path, i)); found {
							   return true, p
					   }
			   }
	   case json.Number:
			   // Found a json.Number at this path
			   return true, path
	   }
	   // No json.Number found in this branch
	   return false, ""
}

// canonicalize re-encodes and decodes a value to strip json.Number wrappers.
// This step: marshals to JSON and unmarshals back to Go native types.
// Any json.Number values are converted to float64 or int64 by encoding/json.
func canonicalize(v any) any {
	   b, _ := json.Marshal(v)
	   var out any
	   _ = json.Unmarshal(b, &out)
	   return out
}


// jsValueToGo converts a js.Value to a Go value recursively
// jsValueToGo recursively converts a JavaScript value (js.Value) to a Go value.
// Handles all JS types: null, undefined, boolean, number, string, array, and object.
func jsValueToGo(v js.Value) any {
	   switch v.Type() {
	   case js.TypeNull, js.TypeUndefined:
			   // JS null/undefined → Go nil
			   return nil
	   case js.TypeBoolean:
			   // JS boolean → Go bool
			   return v.Bool()
	   case js.TypeNumber:
			   // JS number → Go float64
			   return v.Float()
	   case js.TypeString:
			   // JS string → Go string
			   return v.String()
	   case js.TypeObject:
			   // Array or Object
			   if v.InstanceOf(js.Global().Get("Array")) {
					   // JS Array → Go []interface{}
					   arr := make([]interface{}, v.Length())
					   for i := 0; i < v.Length(); i++ {
							   arr[i] = jsValueToGo(v.Index(i))
					   }
					   return arr
			   }
			   // JS Object → Go map[string]interface{}
			   obj := map[string]interface{}{}
			   keys := js.Global().Get("Object").Call("keys", v)
			   for i := 0; i < keys.Length(); i++ {
					   k := keys.Index(i).String()
					   obj[k] = jsValueToGo(v.Get(k))
			   }
			   return obj
	   default:
			   // Any other JS type → Go nil
			   return nil
	   }
}

// containsInferSchema checks if the mapping string uses infer_schema (simple substring match)
// containsInferSchema returns true if the mapping string uses infer_schema (simple substring match).
// Used to optionally trigger extra sanitization for schema inference.
func containsInferSchema(mapping string) bool {
	   return (len(mapping) > 0 && (contains(mapping, ".infer_schema()") || contains(mapping, "infer_schema()")))
}

// contains is a helper for substring search (no import for strings).
func contains(s, substr string) bool {
	   return len(substr) > 0 && (func() bool {
			   for i := 0; i+len(substr) <= len(s); i++ {
					   if s[i:i+len(substr)] == substr {
							   return true
					   }
			   }
			   return false
	   })()
}

var globalEnv *bloblang.Environment

func main() {
	// Initialize the global Bloblang environment
	globalEnv = createMockEnvironment()

	js.Global().Set("blobl", js.FuncOf(blobl))

	// Wait for a signal to shut down
	select {}
}

// blobl is the main entrypoint for the WASM module, called from JavaScript.
// It takes a mapping string, a payload (string or JS object), and optional metadata.
func blobl(_ js.Value, args []js.Value) (output any) {
	   defer func() {
			   // Always return a string, even for errors
			   if o, ok := output.(error); ok {
					   output = "Error: " + o.Error()
			   }
	   }()

	   // Validate argument count
	   if len(args) < 2 || len(args) > 3 {
			   return fmt.Errorf("expected 2 or 3 arguments, received %d instead", len(args))
	   }

	   // Parse the Bloblang mapping
	   mapping, err := globalEnv.Parse(args[0].String())
	   if err != nil {
			   return fmt.Errorf("failed to parse mapping: %s", err)
	   }

	   // --- PAYLOAD HANDLING ---
	   // Always decode to interface{}, fix numbers, canonicalize, then marshal for service.NewMessage
	   // This ensures all numbers are native Go types (float64/int64), never json.Number.
	   var msg *service.Message
	   var data any
	   if args[1].Type() == js.TypeString {
			   payloadBytes := []byte(args[1].String())
			   // Try to unmarshal as JSON (map or array)
			   var temp interface{}
			   if err := json.Unmarshal(payloadBytes, &temp); err == nil {
					   // Re-marshal and unmarshal to force all numbers to native types
					   b, _ := json.Marshal(temp)
					   var canonical interface{}
					   _ = json.Unmarshal(b, &canonical)
					   data = canonical
					   // This sequence ensures all json.Number are converted, even from edge cases
					   data = fixNumbers(data)
					   data = canonicalize(data)
					   data = fixNumbers(data)
					   // Failsafe: check for json.Number before passing to Redpanda Connect
					   if found, path := containsJsonNumber(data, ""); found {
							   return fmt.Errorf("[FAILSAFE] json.Number found at %s before service.NewMessage", path)
					   }
					   b, err := json.Marshal(data)
					   if err != nil {
							   return fmt.Errorf("failed to marshal input: %s", err)
					   }
					   // Final failsafe: check for json.Number in marshaled bytes
					   var check any
					   if err := json.Unmarshal(b, &check); err == nil {
							   if found, path := containsJsonNumber(check, "marshal-check"); found {
									   return fmt.Errorf("[FAILSAFE] json.Number found after marshal at %s", path)
							   }
					   }
					   msg = service.NewMessage(b)
			   } else {
					   // Not JSON, treat as string
					   msg = service.NewMessage([]byte(args[1].String()))
			   }
	   } else {
			   // For non-string input, convert JS value to Go value, fix numbers, canonicalize
			   data = jsValueToGo(args[1])
			   data = fixNumbers(data)
			   data = canonicalize(data)
			   data = fixNumbers(data)
			   // Failsafe: check for json.Number before passing to Redpanda Connect
			   if found, path := containsJsonNumber(data, ""); found {
					   return fmt.Errorf("[FAILSAFE] json.Number found at %s before service.NewMessage", path)
			   }
			   b, err := json.Marshal(data)
			   if err != nil {
					   return fmt.Errorf("failed to marshal input: %s", err)
			   }
			   // Final failsafe: check for json.Number in marshaled bytes
			   var check any
			   if err := json.Unmarshal(b, &check); err == nil {
					   if found, path := containsJsonNumber(check, "marshal-check"); found {
							   return fmt.Errorf("[FAILSAFE] json.Number found after marshal at %s", path)
					   }
			   }
			   msg = service.NewMessage(b)
	   }

	   // --- SCHEMA INFERENCE EXTRA CHECK ---
	   // If mapping contains infer_schema, ensure the message is structured
	   if containsInferSchema(args[0].String()) {
	           val, _ := msg.AsStructured()
	           // Sanitize and re-wrap into the message so the mapping operates on the sanitized structure.
	           val = fixNumbers(val)
	           val = canonicalize(val)
	           val = fixNumbers(val)
	           b, err := json.Marshal(val)
	           if err != nil {
	                   return fmt.Errorf("failed to marshal sanitized input: %s", err)
	           }
	           // Preserve the sanitized payload for schema inference
	           msg = service.NewMessage(b)
	   }

	   // --- METADATA HANDLING ---
	   // Parse the optional metadata (this can still be JSON)
	   metadata := map[string]any{}
	   if len(args) == 3 {
			   if err := json.Unmarshal([]byte(args[2].String()), &metadata); err != nil {
					   return fmt.Errorf("failed to parse metadata: %s", err)
			   }
			   // Fix numbers and canonicalize in metadata as well
			   metadata = canonicalize(fixNumbers(metadata)).(map[string]any)
			   if found, path := containsJsonNumber(metadata, ""); found {
					   return fmt.Errorf("[FAILSAFE] json.Number found in metadata at %s", path)
			   }
	   }

	   // Apply metadata to the message (all values must be strings)
	   for key, value := range metadata {
			   strValue, ok := value.(string)
			   if !ok {
					   return fmt.Errorf("metadata value for key '%s' must be a string, got %T", key, value)
			   }
			   msg.MetaSetMut(key, strValue)
	   }

	   // --- EXECUTE BLOBLANG MAPPING ---
	   result, err := msg.BloblangQuery(mapping)
	   if err != nil {
			   return fmt.Errorf("failed to execute mapping: %s", err)
	   }

	   // --- EXTRACT OUTPUT ---
	   var message any
	   if result == nil {
			   message = nil
	   } else {
			   message, err = result.AsStructured()
			   if err != nil {
					   // If AsStructured fails, fallback to extracting as bytes/string
					   res, err := result.AsBytes()
					   if err != nil {
							   return fmt.Errorf("failed to extract message: %s", err)
					   }
					   message = string(res)
			   }
	   }

	   // Extract metadata (only if we got a non‐nil result)
	   var extractedMetadata map[string]any
	   if result != nil {
			   if err = result.MetaWalkMut(func(key string, value any) error {
					   if extractedMetadata == nil {
							   extractedMetadata = make(map[string]any)
					   }
					   extractedMetadata[key] = value
					   return nil
			   }); err != nil {
					   return fmt.Errorf("failed to extract metadata: %s", err)
			   }
	   }

	   // Marshal the output as pretty JSON
	   payload, err := json.MarshalIndent(struct {
			   Msg  any            `json:"msg"`
			   Meta map[string]any `json:"meta,omitempty"`
	   }{
			   Msg:  message,
			   Meta: extractedMetadata,
	   }, "", "  ")
	   if err != nil {
			   return fmt.Errorf("failed to marshal output: %s", err)
	   }

	   return string(payload)
}

// fixNumbers recursively converts json.Number to float64 or int64.
func fixNumbers(i interface{}) interface{} {
	   switch v := i.(type) {
	   case map[string]interface{}:
			   for k, val := range v {
					   v[k] = fixNumbers(val)
			   }
			   return v
	   case []interface{}:
			   for i, val := range v {
					   v[i] = fixNumbers(val)
			   }
			   return v
	   case json.Number:
			   // Try int first, fallback to float
			   if intVal, err := v.Int64(); err == nil {
					   return intVal
			   }
			   if floatVal, err := v.Float64(); err == nil {
					   return floatVal
			   }
			   return v.String()
	   default:
			   return v
	   }
}

// createMockEnvironment creates a shared Bloblang environment with mocked I/O functions.
func createMockEnvironment() *bloblang.Environment {
	env := bloblang.NewEnvironment()

	// Mock env function
	if err := env.RegisterFunction("env", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			var name string
			var noCache bool

			if len(args) == 1 {
				name, _ = args[0].(string)
			} else if len(args) == 2 {
				switch v := args[0].(type) {
				case string:
					name = v
					noCache, _ = args[1].(bool)
				case map[string]any:
					name, _ = v["name"].(string)
					noCache, _ = v["no_cache"].(bool)
				default:
					return nil, fmt.Errorf("invalid argument format for env")
				}
			} else {
				return nil, fmt.Errorf("invalid number of arguments for env")
			}

			mockValues := map[string]string{
				"key": "mocked_value",
			}
			if val, exists := mockValues[name]; exists {
				if noCache {
					return val + " (no cache)", nil
				}
				return val, nil
			}
			return nil, nil
		}, nil
	}); err != nil {
		panic(err)
	}

	// Mock file function
	if err := env.RegisterFunction("file", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			var path string
			var noCache bool

			if len(args) == 1 {
				path, _ = args[0].(string)
			} else if len(args) == 2 {
				params, ok := args[0].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid argument format for file")
				}
				path, _ = params["path"].(string)
				noCache, _ = params["no_cache"].(bool)
			} else {
				return nil, fmt.Errorf("invalid number of arguments for file")
			}

			mockFiles := map[string]string{
				"/mock/path/file.json": "{\"hello\": \"world\"}",
			}
			if content, exists := mockFiles[path]; exists {
				if noCache {
					return content + " (no_cache)", nil
				}
				return content, nil
			}
			return nil, fmt.Errorf("file not found: %s", path)
		}, nil
	}); err != nil {
		panic(err)
	}

	// Mock file_rel function
	if err := env.RegisterFunction("file_rel", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			var path string
			var noCache bool

			if len(args) == 1 {
				path, _ = args[0].(string)
			} else if len(args) == 2 {
				params, ok := args[0].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid argument format for file_rel")
				}
				path, _ = params["path"].(string)
				noCache, _ = params["no_cache"].(bool)
			} else {
				return nil, fmt.Errorf("invalid number of arguments for file_rel")
			}

			mockFiles := map[string]string{
				"relative/path/file.json": "{\"hello\": \"world\"}",
			}
			if content, exists := mockFiles[path]; exists {
				if noCache {
					return content + " (no_cache)", nil
				}
				return content, nil
			}
			return nil, fmt.Errorf("file not found: %s", path)
		}, nil
	}); err != nil {
		panic(err)
	}

	// Mock hostname function
	if err := env.RegisterFunction("hostname", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			return "mocked-hostname", nil
		}, nil
	}); err != nil {
		panic(err)
	}

	// Override the standard ts_tz method to use JavaScript timezone support
	if err := env.RegisterMethod("ts_tz", func(args ...any) (bloblang.Method, error) {
		if len(args) != 1 {
			return nil, fmt.Errorf("ts_tz expects exactly 1 argument (timezone)")
		}

		timezone, ok := args[0].(string)
		if !ok {
			return nil, fmt.Errorf("timezone argument must be a string")
		}

		// For IANA timezone names (including UTC), verify JavaScript timezone functions are available
		// during method registration, not at runtime
		if timezone != "Local" {
			timezoneFuncs := js.Global().Get("timezoneFuncs")
			if timezoneFuncs.IsUndefined() {
				return nil, fmt.Errorf("IANA timezone '%s' requires JavaScript timezone functions (timezoneFuncs) to be available", timezone)
			}
			
			convertFunc := timezoneFuncs.Get("convertToTimezone")
			if convertFunc.IsUndefined() {
				return nil, fmt.Errorf("IANA timezone '%s' requires convertToTimezone function to be available", timezone)
			}
		}

		// For "Local" timezone only, use the original Go implementation
		if timezone == "Local" {
			return func(v any) (any, error) {
				var timestamp int64
				switch val := v.(type) {
				case int64:
					timestamp = val
				case float64:
					timestamp = int64(val)
				case int:
					timestamp = int64(val)
				default:
					return nil, fmt.Errorf("input must be a Unix timestamp (number)")
				}

				t := time.Unix(timestamp, 0) // Local time
				return t.Unix(), nil
			}, nil
		}

		// For all IANA timezone names (including UTC), use JavaScript conversion
		return func(v any) (any, error) {
			// Convert input to Unix timestamp
			var timestamp float64
			switch val := v.(type) {
			case int64:
				timestamp = float64(val)
			case float64:
				timestamp = val
			case int:
				timestamp = float64(val)
			default:
				return nil, fmt.Errorf("input must be a Unix timestamp (number)")
			}

			// For timezone conversion in WASM, we need to handle this specially
			// since Go's time package doesn't have timezone data available
			
			// Use JavaScript to convert the timestamp to the target timezone
			timezoneFuncs := js.Global().Get("timezoneFuncs")
			convertFunc := timezoneFuncs.Get("convertToTimezone")
			result := convertFunc.Invoke(timestamp, timezone)

			// Check for errors
			if result.Get("error").Truthy() {
				return nil, fmt.Errorf("timezone conversion error: %s", result.Get("error").String())
			}
			
			// Get the timezone-converted parts
			parts := result.Get("parts")
			
			// Parse the local time components in the target timezone
			year, err := parseInt(parts.Get("year").String())
			if err != nil {
				return nil, fmt.Errorf("invalid year value: %w", err)
			}
			month, err := parseInt(parts.Get("month").String())
			if err != nil {
				return nil, fmt.Errorf("invalid month value: %w", err)
			}
			day, err := parseInt(parts.Get("day").String())
			if err != nil {
				return nil, fmt.Errorf("invalid day value: %w", err)
			}
			hour, err := parseInt(parts.Get("hour").String())
			if err != nil {
				return nil, fmt.Errorf("invalid hour value: %w", err)
			}
			// Fix JavaScript Intl.DateTimeFormat bug where it returns hour 24 instead of 0 for midnight
			// This is a known issue where midnight (00:00) is sometimes represented as hour 24
			// Hour 24 should be normalized to hour 0 without changing the date
			if hour == 24 {
				hour = 0
			}
			minute, err := parseInt(parts.Get("minute").String())
			if err != nil {
				return nil, fmt.Errorf("invalid minute value: %w", err)
			}
			second, err := parseInt(parts.Get("second").String())
			if err != nil {
				return nil, fmt.Errorf("invalid second value: %w", err)
			}
			
			// In WASM, since we can't use proper timezone databases, we create
			// a timestamp from the local time components as UTC. This works
			// because subsequent formatting operations treat it as UTC and
			// display the correct local time values.
			localAsUTC := time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC)

			// Return the timestamp - this approach works for formatting operations
			// even though it's not a "true" timezone conversion
			return localAsUTC.Unix(), nil
		}, nil
	}); err != nil {
		panic(err)
	}

	// Override the standard ts_strftime method to use JavaScript timezone support
	if err := env.RegisterMethod("ts_strftime", func(args ...any) (bloblang.Method, error) {
		if len(args) < 1 || len(args) > 2 {
			return nil, fmt.Errorf("ts_strftime expects 1 or 2 arguments (format, optional timezone)")
		}

		format, ok := args[0].(string)
		if !ok {
			return nil, fmt.Errorf("format argument must be a string")
		}

		timezone := ""
		if len(args) == 2 {
			timezone, ok = args[1].(string)
			if !ok {
				return nil, fmt.Errorf("timezone argument must be a string")
			}
		}

		// For IANA timezone names (excluding Local), verify JavaScript timezone functions are available
		if timezone != "" && timezone != "Local" && timezone != "UTC" {
			timezoneFuncs := js.Global().Get("timezoneFuncs")
			if timezoneFuncs.IsUndefined() {
				return nil, fmt.Errorf("IANA timezone '%s' requires JavaScript timezone functions (timezoneFuncs) to be available", timezone)
			}
			
			convertFunc := timezoneFuncs.Get("convertToTimezone")
			if convertFunc.IsUndefined() {
				return nil, fmt.Errorf("IANA timezone '%s' requires convertToTimezone function to be available", timezone)
			}
		}

		return func(v any) (any, error) {
			// Convert input to Unix timestamp
			var timestamp float64
			switch val := v.(type) {
			case int64:
				timestamp = float64(val)
			case float64:
				timestamp = val
			case int:
				timestamp = float64(val)
			case string:
				// Handle RFC 3339 format strings
				t, err := time.Parse(time.RFC3339, val)
				if err != nil {
					return nil, fmt.Errorf("failed to parse RFC 3339 timestamp: %w", err)
				}
				timestamp = float64(t.Unix())
			default:
				return nil, fmt.Errorf("input must be a Unix timestamp (number) or RFC 3339 string")
			}

			// Handle timezone using tagged switch
			switch timezone {
			case "":
				// No timezone specified - in WASM context, default to UTC for consistency
				// since local time is not well-defined in a browser environment
				t := time.Unix(int64(timestamp), 0).UTC()
				return formatStrftime(t, format), nil
			case "Local":
				// Use Go's built-in local time handling (which defaults to UTC in WASM)
				t := time.Unix(int64(timestamp), 0)
				return formatStrftime(t, format), nil
			case "UTC":
				// Use Go's built-in UTC time handling
				t := time.Unix(int64(timestamp), 0).UTC()
				return formatStrftime(t, format), nil
			}

			// For IANA timezone names, use JavaScript conversion first to get the correct local time
			timezoneFuncs := js.Global().Get("timezoneFuncs")
			convertFunc := timezoneFuncs.Get("convertToTimezone")
			result := convertFunc.Invoke(timestamp, timezone)

			// Check for errors
			if result.Get("error").Truthy() {
				return nil, fmt.Errorf("timezone conversion error: %s", result.Get("error").String())
			}
			
			// Get the timezone-converted parts
			parts := result.Get("parts")
			
			// Parse the local time components in the target timezone
			year, err := parseInt(parts.Get("year").String())
			if err != nil {
				return nil, fmt.Errorf("invalid year value: %w", err)
			}
			month, err := parseInt(parts.Get("month").String())
			if err != nil {
				return nil, fmt.Errorf("invalid month value: %w", err)
			}
			day, err := parseInt(parts.Get("day").String())
			if err != nil {
				return nil, fmt.Errorf("invalid day value: %w", err)
			}
			hour, err := parseInt(parts.Get("hour").String())
			if err != nil {
				return nil, fmt.Errorf("invalid hour value: %w", err)
			}
			// Fix JavaScript Intl.DateTimeFormat bug where it returns hour 24 instead of 0 for midnight
			if hour == 24 {
				hour = 0
			}
			minute, err := parseInt(parts.Get("minute").String())
			if err != nil {
				return nil, fmt.Errorf("invalid minute value: %w", err)
			}
			second, err := parseInt(parts.Get("second").String())
			if err != nil {
				return nil, fmt.Errorf("invalid second value: %w", err)
			}
			
			// Create a time in UTC representing the local time in the target timezone
			localAsUTC := time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC)

			// Now format using the provided strftime format
			// For now, use a simplified implementation that handles basic cases
			switch format {
			case "%-H":
				return fmt.Sprintf("%d", hour), nil
			case "%H":
				return fmt.Sprintf("%02d", hour), nil
			case "%Y-%m-%d %H:%M:%S":
				return fmt.Sprintf("%04d-%02d-%02d %02d:%02d:%02d", year, month, day, hour, minute, second), nil
			default:
				// For other formats, use the helper function
				formatted := formatStrftime(localAsUTC, format)
				return formatted, nil
			}
		}, nil
	}); err != nil {
		panic(err)
	}

	return env
}

// Helper functions for timezone conversion
func parseInt(s string) (int, error) {
	var result int
	if _, err := fmt.Sscanf(s, "%d", &result); err != nil {
		return 0, fmt.Errorf("failed to parse integer from string '%s': %w", s, err)
	}
	return result, nil
}

// formatStrftime is a simplified placeholder for strftime formatting.
// A full implementation would require parsing strftime format specifiers
// and converting them to Go's time format syntax.
func formatStrftime(t time.Time, format string) string {
	// This is a basic implementation that handles common strftime specifiers
	// A full implementation would need to handle all strftime format codes
	
	// For now, let's handle the most common cases used in the tests
	result := format
	result = replaceStrftimeSpecifiers(result, t)
	return result
}

// replaceStrftimeSpecifiers replaces common strftime specifiers with Go's time format equivalents.
func replaceStrftimeSpecifiers(format string, t time.Time) string {
	// Handle common strftime specifiers
	result := format
	
	// Year
	result = replaceAll(result, "%Y", t.Format("2006"))     // 4-digit year
	result = replaceAll(result, "%y", t.Format("06"))       // 2-digit year
	
	// Month
	result = replaceAll(result, "%m", t.Format("01"))       // Month as number (01-12)
	result = replaceAll(result, "%b", t.Format("Jan"))      // Abbreviated month name
	result = replaceAll(result, "%B", t.Format("January"))  // Full month name
	
	// Day
	result = replaceAll(result, "%d", t.Format("02"))       // Day of month (01-31)
	result = replaceAll(result, "%e", t.Format("_2"))       // Day of month, space-padded
	
	// Hour
	result = replaceAll(result, "%H", t.Format("15"))       // Hour 24-hour format (00-23)
	result = replaceAll(result, "%I", t.Format("03"))       // Hour 12-hour format (01-12)
	result = replaceAll(result, "%-H", fmt.Sprintf("%d", t.Hour()))  // Hour 24-hour, no padding
	result = replaceAll(result, "%-I", func() string {
		h := t.Hour()
		if h == 0 {
			return "12"
		} else if h > 12 {
			return fmt.Sprintf("%d", h-12)
		} else {
			return fmt.Sprintf("%d", h)
		}
	}())  // Hour 12-hour, no padding
	
	// Minute
	result = replaceAll(result, "%M", t.Format("04"))       // Minute (00-59)
	result = replaceAll(result, "%-M", fmt.Sprintf("%d", t.Minute()))  // Minute, no padding
	
	// Second
	result = replaceAll(result, "%S", t.Format("05"))       // Second (00-59)
	result = replaceAll(result, "%-S", fmt.Sprintf("%d", t.Second()))  // Second, no padding
	
	// Microseconds (Python extension)
	result = replaceAll(result, "%f", fmt.Sprintf("%06d", t.Nanosecond()/1000))  // Microseconds
	
	// AM/PM
	result = replaceAll(result, "%p", t.Format("PM"))       // AM or PM
	
	return result
}

// replaceAll replaces all occurrences of old with new in the string s.
func replaceAll(s, old, new string) string {
	// Simple string replacement - Go's strings.ReplaceAll would be better but keeping it simple
	for {
		newS := ""
		found := false
		i := 0
		for i < len(s) {
			if i <= len(s)-len(old) && s[i:i+len(old)] == old {
				newS += new
				i += len(old)
				found = true
			} else {
				newS += string(s[i])
				i++
			}
		}
		s = newS
		if !found {
			break
		}
	}
	return s
}
