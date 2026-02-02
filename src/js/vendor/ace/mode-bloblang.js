/**
 * Ace Editor mode for Bloblang
 *
 * Bloblang is Redpanda Connect's native mapping language for transforming data.
 * @see https://docs.redpanda.com/redpanda-connect/guides/bloblang/about/
 */
ace.define("ace/mode/bloblang_highlight_rules", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text_highlight_rules"], function(require, exports, module) {
  "use strict";

  var oop = require("../lib/oop");
  var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

  var BloblangHighlightRules = function() {
    // Built-in functions
    var functions = (
      "now|timestamp_unix|timestamp_unix_nano|parse_timestamp|format_timestamp|" +
      "uuid_v4|uuid_v5|nanoid|" +
      "encode|decode|parse_json|parse_yaml|parse_xml|parse_csv|" +
      "env|file|hostname|" +
      "hash|hmac|encrypt|decrypt|" +
      "content|json|meta_from|metadata|" +
      "random_int|range|" +
      "deleted|throw|error|" +
      "type|length|keys|values|" +
      "if|match|batch_index|batch_size|count|" +
      "ksuid|snow_flake|ulid"
    );

    // Built-in methods
    var methods = (
      "uppercase|lowercase|capitalize|trim|split|join|replace|replace_all|" +
      "contains|has_prefix|has_suffix|slice|strip_html|parse_url|re_match|re_find_all|re_replace_all|" +
      "map_each|filter|fold|flatten|unique|collapse|enumerate|sort|reverse|sum|" +
      "any|all|index|append|concat|merge|assign|without|" +
      "abs|ceil|floor|round|max|min|log|pow|sqrt|" +
      "string|number|bool|bytes|not_null|catch|or|" +
      "format_json|format_yaml|format_xml|" +
      "compress|decompress|" +
      "ts_parse|ts_format|ts_unix|ts_unix_nano|ts_add|ts_sub|" +
      "exists|type|length|keys|values|" +
      "encode|decode|hash|hmac"
    );

    // Keywords
    var keywords = "root|this|let|meta|if|else|match|case";

    // Constants
    var constants = "true|false|null";

    var keywordMapper = this.createKeywordMapper({
      "keyword": keywords,
      "constant.language": constants,
      "support.function": functions
    }, "identifier");

    this.$rules = {
      "start": [
        // Comments
        {
          token: "comment.line",
          regex: "#.*$"
        },
        // Multi-line strings
        {
          token: "string.quoted.triple",
          regex: '"""',
          next: "triple_string"
        },
        // Double-quoted strings
        {
          token: "string.quoted.double",
          regex: '"',
          next: "double_string"
        },
        // Single-quoted strings
        {
          token: "string.quoted.single",
          regex: "'",
          next: "single_string"
        },
        // Metadata accessor (@field)
        {
          token: "variable.other.metadata",
          regex: "@[\\w-]+"
        },
        // Variable reference ($var)
        {
          token: "variable.other",
          regex: "\\$[\\w-]+"
        },
        // Methods (after dot)
        {
          token: ["punctuation.operator", "support.function.method"],
          regex: "(\\.)(" + methods + ")(?=\\s*\\()"
        },
        // Wildcard spread operator (e.g., root.*, this.*)
        {
          token: "keyword.operator.spread",
          regex: "\\.\\*"
        },
        // Property access (after dot, not a method)
        {
          token: ["punctuation.operator", "variable.other.property"],
          regex: "(\\.)(\\w+)"
        },
        // Functions
        {
          token: "support.function",
          regex: "\\b(" + functions + ")\\b(?=\\s*\\()"
        },
        // Keywords and identifiers
        {
          token: keywordMapper,
          regex: "\\b\\w+\\b"
        },
        // Numbers
        {
          token: "constant.numeric",
          regex: "-?(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)"
        },
        // Arrow operator
        {
          token: "punctuation.operator.arrow",
          regex: "->"
        },
        // Comparison and logical operators
        {
          token: "keyword.operator.comparison",
          regex: "<=|>=|==|!=|<|>|&&|\\|\\||!"
        },
        // Assignment
        {
          token: "keyword.operator.assignment",
          regex: "="
        },
        // Arithmetic operators
        {
          token: "keyword.operator.arithmetic",
          regex: "[+\\-*/%]"
        },
        // Pipe/coalesce operator
        {
          token: "keyword.operator.pipe",
          regex: "\\|"
        },
        // Punctuation
        {
          token: "paren.lparen",
          regex: "[\\[\\(\\{]"
        },
        {
          token: "paren.rparen",
          regex: "[\\]\\)\\}]"
        },
        {
          token: "punctuation.operator",
          regex: "[;:,]"
        }
      ],
      "triple_string": [
        {
          token: "string.quoted.triple",
          regex: '"""',
          next: "start"
        },
        {
          defaultToken: "string.quoted.triple"
        }
      ],
      "double_string": [
        {
          token: "constant.character.escape",
          regex: "\\\\."
        },
        {
          token: "string.quoted.double",
          regex: '"',
          next: "start"
        },
        {
          defaultToken: "string.quoted.double"
        }
      ],
      "single_string": [
        {
          token: "constant.character.escape",
          regex: "\\\\."
        },
        {
          token: "string.quoted.single",
          regex: "'",
          next: "start"
        },
        {
          defaultToken: "string.quoted.single"
        }
      ]
    };
  };

  oop.inherits(BloblangHighlightRules, TextHighlightRules);
  exports.BloblangHighlightRules = BloblangHighlightRules;
});

ace.define("ace/mode/bloblang", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text", "ace/mode/bloblang_highlight_rules"], function(require, exports, module) {
  "use strict";

  var oop = require("../lib/oop");
  var TextMode = require("./text").Mode;
  var BloblangHighlightRules = require("./bloblang_highlight_rules").BloblangHighlightRules;

  var Mode = function() {
    this.HighlightRules = BloblangHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
  };

  oop.inherits(Mode, TextMode);

  (function() {
    this.lineCommentStart = "#";
    this.$id = "ace/mode/bloblang";
  }).call(Mode.prototype);

  exports.Mode = Mode;
});
