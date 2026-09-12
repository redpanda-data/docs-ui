/**
 * Stand-in for the bare 'react-syntax-highlighter' import inside
 * @kapaai/agent-react (the signed-in Ask AI tier renders code blocks with
 * `import { Prism } from 'react-syntax-highlighter'`). That default Prism
 * build bundles every refractor grammar: ~780 KB minified, a third of the
 * whole drawer. PrismLight is the same component with no grammars, so
 * register the ones Redpanda answers actually contain and hand it back under
 * the same export name. bundle-react.js swaps this file in with an esbuild
 * resolve plugin, so the SDK source is untouched. Unregistered languages
 * render as plain text, not an error.
 */
import PrismLight from 'react-syntax-highlighter/dist/esm/prism-light'
import bash from 'refractor/lang/bash.js'
import yaml from 'refractor/lang/yaml.js'
import json from 'refractor/lang/json.js'
import javascript from 'refractor/lang/javascript.js'
import typescript from 'refractor/lang/typescript.js'
import jsx from 'refractor/lang/jsx.js'
import tsx from 'refractor/lang/tsx.js'
import go from 'refractor/lang/go.js'
import python from 'refractor/lang/python.js'
import java from 'refractor/lang/java.js'
import sql from 'refractor/lang/sql.js'
import markup from 'refractor/lang/markup.js'
import css from 'refractor/lang/css.js'
import docker from 'refractor/lang/docker.js'
import properties from 'refractor/lang/properties.js'
import toml from 'refractor/lang/toml.js'
import ini from 'refractor/lang/ini.js'
import rust from 'refractor/lang/rust.js'
import csharp from 'refractor/lang/csharp.js'
import kotlin from 'refractor/lang/kotlin.js'
import scala from 'refractor/lang/scala.js'
import ruby from 'refractor/lang/ruby.js'
import php from 'refractor/lang/php.js'
import protobuf from 'refractor/lang/protobuf.js'
import graphql from 'refractor/lang/graphql.js'
import powershell from 'refractor/lang/powershell.js'
import diff from 'refractor/lang/diff.js'
import makefile from 'refractor/lang/makefile.js'
import nginx from 'refractor/lang/nginx.js'
import http from 'refractor/lang/http.js'
import markdown from 'refractor/lang/markdown.js'
import hcl from 'refractor/lang/hcl.js'

const LANGUAGES = [
  ['bash', bash],
  ['yaml', yaml],
  ['json', json],
  ['javascript', javascript],
  ['typescript', typescript],
  ['jsx', jsx],
  ['tsx', tsx],
  ['go', go],
  ['python', python],
  ['java', java],
  ['sql', sql],
  ['markup', markup],
  ['css', css],
  ['docker', docker],
  ['properties', properties],
  ['toml', toml],
  ['ini', ini],
  ['rust', rust],
  ['csharp', csharp],
  ['kotlin', kotlin],
  ['scala', scala],
  ['ruby', ruby],
  ['php', php],
  ['protobuf', protobuf],
  ['graphql', graphql],
  ['powershell', powershell],
  ['diff', diff],
  ['makefile', makefile],
  ['nginx', nginx],
  ['http', http],
  ['markdown', markdown],
  ['hcl', hcl],
]
LANGUAGES.forEach(([name, grammar]) => PrismLight.registerLanguage(name, grammar))
// Aliases the SDK is likely to be handed via ```lang fences
PrismLight.registerLanguage('sh', bash)
PrismLight.registerLanguage('shell', bash)
PrismLight.registerLanguage('yml', yaml)
PrismLight.registerLanguage('js', javascript)
PrismLight.registerLanguage('ts', typescript)
PrismLight.registerLanguage('py', python)
PrismLight.registerLanguage('html', markup)
PrismLight.registerLanguage('xml', markup)
PrismLight.registerLanguage('dockerfile', docker)
PrismLight.registerLanguage('proto', protobuf)
PrismLight.registerLanguage('terraform', hcl)

export { PrismLight as Prism }
export default PrismLight
