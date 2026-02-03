/**
 * Prism syntax highlighting for Bloblang (blobl)
 *
 * Bloblang is Redpanda Connect's native mapping language for transforming data.
 * @see https://docs.redpanda.com/redpanda-connect/guides/bloblang/about/
 *
 * AUTO-GENERATED from Connect JSON - do not edit manually.
 * Run: gulp generate:bloblang-grammar
 */

(function (Prism) {
  var functions = ["batch_index","batch_size","bytes","content","count","counter","deleted","env","error","error_source_label","error_source_name","error_source_path","errored","fake","file","file_rel","hostname","json","ksuid","meta","metadata","nanoid","nothing","now","pi","random_int","range","root_meta","snowflake_id","throw","timestamp_unix","timestamp_unix_micro","timestamp_unix_milli","timestamp_unix_nano","tracing_id","tracing_span","ulid","uuid_v4","uuid_v7","var","with_schema_registry_header"].join('|');
  var methods = ["abs","all","any","append","apply","array","assign","bitwise_and","bitwise_or","bitwise_xor","bloblang","bool","bytes","capitalize","catch","ceil","collapse","compare_argon2","compare_bcrypt","compress","concat","contains","cos","decode","decompress","decrypt_aes","diff","encode","encrypt_aes","enumerated","escape_html","escape_url_query","exists","explode","filepath_join","filepath_split","filter","find","find_all","find_all_by","find_by","flatten","float32","float64","floor","fold","format","format_json","format_msgpack","format_timestamp","format_timestamp_strftime","format_timestamp_unix","format_timestamp_unix_micro","format_timestamp_unix_milli","format_timestamp_unix_nano","format_xml","format_yaml","from","from_all","geoip_anonymous_ip","geoip_asn","geoip_city","geoip_connection_type","geoip_country","geoip_domain","geoip_enterprise","geoip_isp","get","has_prefix","has_suffix","hash","index","index_of","infer_schema","int16","int32","int64","int8","join","json_path","json_schema","key_values","keys","length","log","log10","lowercase","map","map_each","map_each_key","max","merge","min","not","not_empty","not_null","number","or","parse_csv","parse_duration","parse_duration_iso8601","parse_form_url_encoded","parse_json","parse_jwt_es256","parse_jwt_es384","parse_jwt_es512","parse_jwt_hs256","parse_jwt_hs384","parse_jwt_hs512","parse_jwt_rs256","parse_jwt_rs384","parse_jwt_rs512","parse_msgpack","parse_parquet","parse_timestamp","parse_timestamp_strptime","parse_url","parse_xml","parse_yaml","patch","pow","quote","re_find_all","re_find_all_object","re_find_all_submatch","re_find_object","re_match","re_replace","re_replace_all","repeat","replace","replace_all","replace_all_many","replace_many","reverse","round","sign_jwt_es256","sign_jwt_es384","sign_jwt_es512","sign_jwt_hs256","sign_jwt_hs384","sign_jwt_hs512","sign_jwt_rs256","sign_jwt_rs384","sign_jwt_rs512","sin","slice","slug","sort","sort_by","split","squash","string","strip_html","sum","tan","timestamp","trim","trim_prefix","trim_suffix","ts_add_iso8601","ts_format","ts_parse","ts_round","ts_strftime","ts_strptime","ts_sub","ts_sub_iso8601","ts_tz","ts_unix","ts_unix_micro","ts_unix_milli","ts_unix_nano","type","uint16","uint32","uint64","uint8","unescape_html","unescape_url_query","unicode_segments","unique","unquote","uppercase","uuid_v5","values","vector","with","without","zip"].join('|');

  Prism.languages.bloblang = {
    'comment': {
      pattern: /#.*/,
      greedy: true
    },

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

    'spread': {
      pattern: /\.\*/,
      alias: 'operator'
    },

    'keyword': {
      pattern: /\b(?:root|this|let|meta|if|else|match|case|_)\b/,
      lookbehind: false
    },

    'function': {
      pattern: new RegExp('\\b(?:' + functions + ')(?=\\s*\\()', 'i')
    },

    'method': {
      pattern: new RegExp('\\.\\s*(?:' + methods + ')(?=\\s*\\()', 'i'),
      inside: {
        'punctuation': /^\./
      }
    },

    'boolean': /\b(?:true|false)\b/,

    'null': {
      pattern: /\bnull\b/,
      alias: 'keyword'
    },

    'number': /\b-?(?:0x[\da-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)\b/i,

    'metadata': {
      pattern: /@(?:[\w-]+|\.[\w-]+|\()/,
      alias: 'variable'
    },

    'variable': {
      pattern: /\$[\w-]+/
    },

    'operator': [
      /->/,
      {
        pattern: /\|/,
        alias: 'coalesce'
      },
      /[<>]=?|[!=]=?|&&|\|\||!(?!=)/,
      /=/,
      /[+\-*\/%]/
    ],

    'punctuation': /[{}[\]();:,]|\.(?!\*)|->|\.\.\.?/,

    'property': {
      pattern: /\.[\w-]+/,
      inside: {
        'punctuation': /^\./
      }
    }
  };

  Prism.languages.blobl = Prism.languages.bloblang;

}(Prism));
