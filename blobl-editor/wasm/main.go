package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/redpanda-data/benthos/v4/public/bloblang"
	"github.com/redpanda-data/benthos/v4/public/service"
	_ "github.com/redpanda-data/connect/v4/public/components/pure/extended"
)

var globalEnv *bloblang.Environment

func main() {
	// Initialize the global Bloblang environment
	globalEnv = createMockEnvironment()

	js.Global().Set("blobl", js.FuncOf(blobl))

	// Wait for a signal to shut down
	select {}
}

func blobl(_ js.Value, args []js.Value) (output any) {
	defer func() {
		// Make sure we return a string instead of an error
		if o, ok := output.(error); ok {
			output = "Error: " + o.Error()
		}
	}()

	if len(args) < 2 || len(args) > 3 {
		return fmt.Errorf("expected 2 or 3 arguments, received %d instead", len(args))
	}

	// Parse the mapping
	mapping, err := globalEnv.Parse(args[0].String())
	if err != nil {
		return fmt.Errorf("failed to parse mapping: %s", err)
	}

	// Take the raw data without unmarshaling
	payloadBytes := []byte(args[1].String())

	// Create the message from the raw bytes
	msg := service.NewMessage(payloadBytes)

	// Parse the optional metadata (this can still be JSON)
	metadata := map[string]any{}
	if len(args) == 3 {
		if err := json.Unmarshal([]byte(args[2].String()), &metadata); err != nil {
			return fmt.Errorf("failed to parse metadata: %s", err)
		}
	}

	// Apply metadata to the message
	for key, value := range metadata {
		strValue, ok := value.(string)
		if !ok {
			return fmt.Errorf("metadata value for key '%s' must be a string, got %T", key, value)
		}
		msg.MetaSetMut(key, strValue)
	}

	// Execute the mapping
	result, err := msg.BloblangQuery(mapping)
	if err != nil {
		return fmt.Errorf("failed to execute mapping: %s", err)
	}

	var message any
	if result == nil {
		message = nil
	} else {
		message, err = result.AsStructured()
		if err != nil {
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

// createMockEnvironment creates a shared Bloblang environment with mocked I/O functions.
func createMockEnvironment() *bloblang.Environment {
	env := bloblang.NewEnvironment()

	// Mock `env` function
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
					return nil, fmt.Errorf("invalid argument format for `env`")
				}
			} else {
				return nil, fmt.Errorf("invalid number of arguments for `env`")
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

	// Mock `file` function
	if err := env.RegisterFunction("file", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			var path string
			var noCache bool

			if len(args) == 1 {
				path, _ = args[0].(string)
			} else if len(args) == 2 {
				params, ok := args[0].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid argument format for `file`")
				}
				path, _ = params["path"].(string)
				noCache, _ = params["no_cache"].(bool)
			} else {
				return nil, fmt.Errorf("invalid number of arguments for `file`")
			}

			mockFiles := map[string]string{
				"/mock/path/file.json": `{"hello": "world"}`,
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

	// Mock `file_rel` function
	if err := env.RegisterFunction("file_rel", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			var path string
			var noCache bool

			if len(args) == 1 {
				path, _ = args[0].(string)
			} else if len(args) == 2 {
				params, ok := args[0].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid argument format for `file_rel`")
				}
				path, _ = params["path"].(string)
				noCache, _ = params["no_cache"].(bool)
			} else {
				return nil, fmt.Errorf("invalid number of arguments for `file_rel`")
			}

			mockFiles := map[string]string{
				"relative/path/file.json": `{"hello": "world"}`,
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

	// Mock `hostname` function
	if err := env.RegisterFunction("hostname", func(args ...any) (bloblang.Function, error) {
		return func() (any, error) {
			return "mocked-hostname", nil
		}, nil
	}); err != nil {
		panic(err)
	}

	return env
}
