/**
 * Prism syntax highlighting for Bloblang (blobl)
 *
 * Bloblang is Redpanda Connect's native mapping language for transforming data.
 * @see https://docs.redpanda.com/redpanda-connect/guides/bloblang/about/
 */

(function (Prism) {
  // Helper to match common Bloblang functions
  var functions = [
    // Timestamp functions
    'now', 'timestamp_unix', 'timestamp_unix_nano', 'parse_timestamp', 'format_timestamp',
    // UUID functions
    'uuid_v4', 'uuid_v5', 'nanoid',
    // Encoding functions
    'encode', 'decode', 'parse_json', 'parse_yaml', 'parse_xml', 'parse_csv',
    // Environment and system
    'env', 'file', 'hostname',
    // Crypto functions
    'hash', 'hmac', 'encrypt', 'decrypt',
    // Content functions
    'content', 'json', 'meta_from', 'metadata',
    // Generation functions
    'random_int', 'range',
    // Error handling
    'deleted', 'throw', 'error',
    // Type functions
    'type', 'length', 'keys', 'values',
    // Conditional
    'if', 'match'
  ].join('|');

  // Common methods (partial list)
  var methods = [
    // String methods
    'uppercase', 'lowercase', 'capitalize', 'trim', 'split', 'join', 'replace', 'replace_all',
    'contains', 'has_prefix', 'has_suffix', 'slice', 'strip_html', 'parse_url',
    // Array methods
    'map_each', 'filter', 'fold', 'flatten', 'unique', 'collapse', 'enumerate', 'sort',
    // Numeric methods
    'abs', 'ceil', 'floor', 'round', 'max', 'min',
    // Type methods
    'string', 'number', 'bool', 'bytes', 'not_null', 'catch',
    // JSON methods
    'format_json', 'parse_json',
    // Encoding methods
    'encode', 'decode', 'compress', 'decompress',
    // Crypto methods
    'hash', 'hmac'
  ].join('|');

  Prism.languages.bloblang = {
    'comment': {
      pattern: /#.*/,
      greedy: true
    },

    // Multi-line strings with triple quotes
    'string': [
      {
        pattern: /"""[\s\S]*?"""/,
        greedy: true,
        alias: 'multiline-string'
      },
      {
        pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
        greedy: true
      }
    ],

    // Wildcard spread operator (e.g., root.*, this.*) - must be before punctuation
    'spread': {
      pattern: /\.\*/,
      alias: 'operator'
    },

    // Keywords
    'keyword': {
      pattern: /\b(?:root|this|let|meta|if|else|match|case|_)\b/,
      lookbehind: false
    },

    // Built-in functions
    'function': {
      pattern: new RegExp('\\b(?:' + functions + ')(?=\\s*\\()', 'i')
    },

    // Methods (called with dot notation)
    'method': {
      pattern: new RegExp('\\.\\s*(?:' + methods + ')(?=\\s*\\()', 'i'),
      inside: {
        'punctuation': /^\./
      }
    },

    // Boolean values
    'boolean': /\b(?:true|false)\b/,

    // Null
    'null': {
      pattern: /\bnull\b/,
      alias: 'keyword'
    },

    // Numbers (including scientific notation)
    'number': /\b-?(?:0x[\da-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)\b/i,

    // Metadata accessor
    'metadata': {
      pattern: /@(?:[\w-]+|\.[\w-]+|\()/,
      alias: 'variable'
    },

    // Variable references
    'variable': {
      pattern: /\$[\w-]+/
    },

    // Operators
    'operator': [
      // Arrow operator
      /->/,
      // Pipe operator for coalescing
      {
        pattern: /\|/,
        alias: 'coalesce'
      },
      // Comparison and logical operators
      /[<>]=?|[!=]=?|&&|\|\||!(?!=)/,
      // Assignment
      /=/,
      // Arithmetic
      /[+\-*\/%]/
    ],

    // Punctuation (exclude . when followed by * to allow spread operator)
    'punctuation': /[{}[\]();:,]|\.(?!\*)|->|\.\.\.?/,

    // Property access (anything after a dot that's not a method)
    'property': {
      pattern: /\.[\w-]+/,
      inside: {
        'punctuation': /^\./
      }
    }
  };

  // Add blobl as an alias
  Prism.languages.blobl = Prism.languages.bloblang;

}(Prism));
