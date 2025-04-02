// +build js,wasm

package main

import (
	"fmt"
	"log"
	"syscall/js"

	"sigs.k8s.io/yaml"
)

func main() {
	// Recover from unexpected panics to avoid crashing the WASM module.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic: %v", r)
		}
	}()
	js.Global().Set("convertYAML", js.FuncOf(convertYAML))
	select {}
}

// Convert transforms a Console v2 configuration into a v3 configuration.
func Convert(v2 map[string]interface{}) (map[string]interface{}, string, error) {
	v3 := make(map[string]interface{})
	var warnings []string

	// Migrate authentication.
	auth, warnAuth, err := migrateAuthentication(v2)
	if err != nil {
		return nil, "", fmt.Errorf("authentication migration: %w", err)
	}
	warnings = append(warnings, warnAuth...)
	if auth != nil {
		v3["authentication"] = auth
	} else if authAlt, ok := v2["authentication"].(map[string]interface{}); ok {
		v3["authentication"] = authAlt
	}

	// Migrate Kafka settings (including schemaRegistry and serde).
	kafka, warnKafka, err := migrateKafka(v2)
	if err != nil {
		return nil, "", fmt.Errorf("kafka migration: %w", err)
	}
	warnings = append(warnings, warnKafka...)

	// Extract schemaRegistry from kafka and add it as a top-level key.
	if sr, ok := kafka["schemaRegistry"]; ok {
		v3["schemaRegistry"] = sr
		delete(kafka, "schemaRegistry")
	}
	v3["kafka"] = kafka

	// Rename connect to kafkaConnect.
	if connect, ok := v2["connect"]; ok {
		v3["kafkaConnect"] = connect
	}

	// Migrate console settings into serde.
	serde, err := migrateConsole(v2)
	if err != nil {
		return nil, "", fmt.Errorf("console migration: %w", err)
	}
	v3["serde"] = serde

	// Migrate roleBindings.
	roleBindings, warnRB, err := migrateRoleBindings(v2)
	if err != nil {
		return nil, "", fmt.Errorf("roleBindings migration: %w", err)
	}
	warnings = append(warnings, warnRB...)
	if roleBindings != nil {
		v3["authorization"] = map[string]interface{}{
			"roleBindings": roleBindings,
		}
	}

	// Migrate redpanda.adminApi credentials.
	redpanda, err := migrateAdminAPI(v2)
	if err != nil {
		return nil, "", fmt.Errorf("adminApi migration: %w", err)
	}
	if redpanda != nil {
		v3["redpanda"] = redpanda
	}

	// Copy any remaining top-level fields.
	copyRemainingFields(v2, v3)

	// Build warnings string as YAML comments.
	var warningComments string
	if len(warnings) > 0 {
		warningComments = "# Conversion Warnings:\n"
		for _, warn := range warnings {
			warningComments += "# " + warn + "\n"
		}
	}

	return v3, warningComments, nil
}

// migrateAuthentication handles the conversion of the login stanza.
func migrateAuthentication(v2 map[string]interface{}) (map[string]interface{}, []string, error) {
	var warnings []string
	var oidcCandidate map[string]interface{}

	if login, ok := v2["login"].(map[string]interface{}); ok {
		auth := make(map[string]interface{})
		if jwt, ok := login["jwtSecret"]; ok {
			auth["jwtSigningSecret"] = jwt
		}
		if sc, ok := login["useSecureCookies"]; ok {
			auth["useSecureCookies"] = sc
		}
		if plain, ok := login["plain"].(map[string]interface{}); ok {
			if enabled, ok := plain["enabled"].(bool); ok && enabled {
				auth["basic"] = map[string]interface{}{"enabled": true}
			}
		}
		// Check various OIDC provider blocks.
		if oidc, ok := login["oidc"].(map[string]interface{}); ok {
			if enabled, ok := oidc["enabled"].(bool); ok && enabled {
				oidcCandidate = oidc
			}
		} else if google, ok := login["google"].(map[string]interface{}); ok {
			if enabled, ok := google["enabled"].(bool); ok && enabled {
				oidcCandidate = google
			}
		} else if okta, ok := login["okta"].(map[string]interface{}); ok {
			if enabled, ok := okta["enabled"].(bool); ok && enabled {
				oidcCandidate = okta
			}
		} else if azuread, ok := login["azureAd"].(map[string]interface{}); ok {
			if enabled, ok := azuread["enabled"].(bool); ok && enabled {
				oidcCandidate = azuread
			}
		} else if github, ok := login["github"].(map[string]interface{}); ok {
			if enabled, ok := github["enabled"].(bool); ok && enabled {
				oidcCandidate = github
			}
		} else if keycloak, ok := login["keycloak"].(map[string]interface{}); ok {
			if enabled, ok := keycloak["enabled"].(bool); ok && enabled {
				oidcCandidate = keycloak
			}
		}
		if oidcCandidate != nil {
			// Remove unsupported keys.
			if _, exists := oidcCandidate["realm"]; exists {
				delete(oidcCandidate, "realm")
				warnings = append(warnings, "Removed the 'realm' option. OIDC groups are not supported in v3. Create roles in Redpanda instead.")
			}
			if _, exists := oidcCandidate["directory"]; exists {
				delete(oidcCandidate, "directory")
				warnings = append(warnings, "Removed the 'directory' option. OIDC groups are not supported in v3. Create roles in Redpanda instead.")
			}
			auth["oidc"] = oidcCandidate
		}
		return auth, warnings, nil
	}
	// If login is not defined, return nil.
	return nil, warnings, nil
}

// migrateKafka handles the migration of Kafka settings and schemaRegistry.
func migrateKafka(v2 map[string]interface{}) (map[string]interface{}, []string, error) {
	var warnings []string
	kafka := make(map[string]interface{})
	kafka["sasl"] = map[string]interface{}{
		"enabled":         true,
		"impersonateUser": true,
	}
	if oldKafka, ok := v2["kafka"].(map[string]interface{}); ok {
		// Process schemaRegistry from v2 (which is under kafka) and later promote it to top-level.
		if srRaw, ok := oldKafka["schemaRegistry"].(map[string]interface{}); ok {
			newSR := make(map[string]interface{})
			authBlock := make(map[string]interface{})
			if username, ok := srRaw["username"]; ok {
				if password, ok := srRaw["password"]; ok {
					authBlock["basic"] = map[string]interface{}{
						"username": username,
						"password": password,
					}
				}
			}
			if token, ok := srRaw["bearerToken"]; ok {
				authBlock["bearerToken"] = token
			}
			if _, ok := srRaw["username"]; ok {
				authBlock["impersonateUser"] = false
			} else {
				authBlock["impersonateUser"] = true
			}
			delete(srRaw, "username")
			delete(srRaw, "password")
			delete(srRaw, "bearerToken")
			if len(authBlock) > 0 {
				newSR["authentication"] = authBlock
			}
			for k, v := range srRaw {
				newSR[k] = v
			}
			// Instead of adding newSR into kafka, we'll let Convert() extract it.
			kafka["schemaRegistry"] = newSR
		}

		// Migrate serde settings.
		serde := make(map[string]interface{})
		if proto, ok := oldKafka["protobuf"]; ok {
			serde["protobuf"] = proto
		}
		if cbor, ok := oldKafka["cbor"]; ok {
			serde["cbor"] = cbor
		}
		if mp, ok := oldKafka["messagePack"]; ok {
			serde["messagePack"] = mp
		}
		// Copy remaining kafka fields.
		for key, val := range oldKafka {
			if key == "schemaRegistry" || key == "protobuf" || key == "cbor" || key == "messagePack" {
				continue
			}
			kafka[key] = val
		}
	}
	return kafka, warnings, nil
}

// migrateConsole moves console.maxDeserializationPayloadSize into a serde.console block.
func migrateConsole(v2 map[string]interface{}) (map[string]interface{}, error) {
	serde := make(map[string]interface{})
	if console, ok := v2["console"].(map[string]interface{}); ok {
		if maxPayload, ok := console["maxDeserializationPayloadSize"]; ok {
			serde["console"] = map[string]interface{}{
				"maxDeserializationPayloadSize": maxPayload,
			}
		}
	}
	return serde, nil
}

// migrateRoleBindings converts v2 roleBindings into v3 authorization.roleBindings.
func migrateRoleBindings(v2 map[string]interface{}) ([]interface{}, []string, error) {
	var warnings []string
	var newRBs []interface{}
	if rbs, ok := v2["roleBindings"].([]interface{}); ok {
		for _, rb := range rbs {
			if rbMap, ok := rb.(map[string]interface{}); ok {
				newRB := make(map[string]interface{})
				if roleName, ok := rbMap["roleName"]; ok {
					newRB["roleName"] = roleName
				}
				if subjects, ok := rbMap["subjects"].([]interface{}); ok {
					var newUsers []interface{}
					for _, subj := range subjects {
						if subjMap, ok := subj.(map[string]interface{}); ok {
							// Only include subjects of kind "user".
							if kindVal, ok := subjMap["kind"].(string); !ok || kindVal != "user" {
								if roleName, ok := rbMap["roleName"].(string); ok {
									warnings = append(warnings, fmt.Sprintf("Removed group subject from role binding '%s'. Groups are not supported in v3.", roleName))
								} else {
									warnings = append(warnings, "Removed a group subject from a role binding. Groups are not supported in v3.")
								}
								continue
							}
							user := make(map[string]interface{})
							// Map provider: if "Plain", set loginType to "basic"; otherwise, use "oidc".
							if prov, ok := subjMap["provider"].(string); ok {
								if prov == "Plain" {
									user["loginType"] = "basic"
								} else {
									user["loginType"] = "oidc"
								}
							} else {
								user["loginType"] = "oidc"
							}
							if name, ok := subjMap["name"]; ok {
								user["name"] = name
							}
							newUsers = append(newUsers, user)
						}
					}
					if len(newUsers) > 0 {
						newRB["users"] = newUsers
					}
				}
				newRBs = append(newRBs, newRB)
			}
		}
	}
	return newRBs, warnings, nil
}

// migrateAdminAPI migrates redpanda.adminApi credentials.
func migrateAdminAPI(v2 map[string]interface{}) (map[string]interface{}, error) {
	if redpandaRaw, ok := v2["redpanda"].(map[string]interface{}); ok {
		if adminApiRaw, ok := redpandaRaw["adminApi"].(map[string]interface{}); ok {
			newAdminApi := make(map[string]interface{})
			authBlock := make(map[string]interface{})
			if username, ok := adminApiRaw["username"]; ok {
				if password, ok := adminApiRaw["password"]; ok {
					authBlock["basic"] = map[string]interface{}{
						"username": username,
						"password": password,
					}
				}
			}
			if _, ok := adminApiRaw["username"]; ok {
				authBlock["impersonateUser"] = false
			} else {
				authBlock["impersonateUser"] = true
			}
			delete(adminApiRaw, "username")
			delete(adminApiRaw, "password")
			if len(authBlock) > 0 {
				newAdminApi["authentication"] = authBlock
			}
			for k, v := range adminApiRaw {
				newAdminApi[k] = v
			}
			return newAdminApi, nil
		}
	}
	return nil, nil
}

// copyRemainingFields copies any top-level fields from v2 to v3 that weren't already migrated.
func copyRemainingFields(v2, v3 map[string]interface{}) {
	skip := map[string]bool{
		"login":          true,
		"authentication": true,
		"kafka":          true,
		"connect":        true,
		"roleBindings":   true,
		"enterprise":     true,
		"console":        true,
	}
	for key, val := range v2 {
		if skip[key] {
			continue
		}
		if _, exists := v3[key]; !exists {
			v3[key] = val
		}
	}
}

func convertYAML(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.ValueOf("Error: no input provided")
	}
	input := args[0].String()
	var v2 map[string]interface{}
	if err := yaml.Unmarshal([]byte(input), &v2); err != nil {
		return js.ValueOf(fmt.Sprintf("Error unmarshaling input: %v", err))
	}

	converted, warnings, err := Convert(v2)
	if err != nil {
		return js.ValueOf(fmt.Sprintf("Error converting: %v", err))
	}

	out, err := yaml.Marshal(converted)
	if err != nil {
		return js.ValueOf(fmt.Sprintf("Error marshaling output: %v", err))
	}

	finalOutput := string(out)
	if warnings != "" {
		finalOutput = warnings + "\n" + finalOutput
	}
	return js.ValueOf(finalOutput)
}
