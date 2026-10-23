const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const https = require('https');

const helpersDir = path.join(__dirname, 'src', 'helpers');
if (fs.existsSync(helpersDir)) {
  fs.readdirSync(helpersDir).forEach((file) => {
    if (file.endsWith('.js')) {
      const name = path.basename(file, '.js');
      const helperFn = require(path.join(helpersDir, file));
      if (typeof helperFn !== 'function') {
        console.warn(`⚠️ Skipping ${file}: not a function`);
        return;
      }
      Handlebars.registerHelper(name, helperFn);
    }
  });
}

// The latest Self-Managed version, as the live docs site states it in every
// page's <meta name="latest-redpanda-version">. The site is public, so this
// needs no token (redpanda-data/docs, which holds antora.yml, is private).
const LATEST_VERSION_URL = 'https://docs.redpanda.com/home/'

function fetchLatestVersion () {
  return new Promise((resolve, reject) => {
    // agent: false so no kept-alive socket holds the process open afterwards.
    const req = https.get(LATEST_VERSION_URL, { agent: false }, (res) => {
      if (res.statusCode !== 200) {
        // Drain the response: an unread body keeps the socket, and the
        // process, open, so the build would hang here.
        res.resume()
        return reject(new Error(`${LATEST_VERSION_URL} returned ${res.statusCode}`))
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        const match = /<meta\s+name="latest-redpanda-version"\s+content="([^"]*)"/i.exec(body)
        const version = match && match[1].trim()
        if (!version || !/^\d+\.\d+$/.test(version)) {
          return reject(new Error(`no latest-redpanda-version meta tag in ${LATEST_VERSION_URL}`))
        }
        resolve(version)
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => req.destroy(new Error('timed out after 10 s')))
  })
}

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️ Failed to read context JSON (${filepath}), using empty context.`);
    return {};
  }
}

// Parse args
const args = process.argv.slice(2);
const [partialName, jsonPathOrFlag, ...rest] = args;

if (!partialName) {
  console.error('❌ Usage: node compile-partial.js <partial-name> [context.json] [--jsScripts=\'["a.js"]\']');
  process.exit(1);
}

// Flags
let jsonPath = null;
let jsScripts = [];

for (const arg of [jsonPathOrFlag, ...rest]) {
  if (arg?.startsWith('--jsScripts=')) {
    try {
      jsScripts = JSON.parse(arg.split('=')[1]);
    } catch {
      console.warn('⚠️ Invalid --jsScripts argument. Skipping.');
    }
  } else if (arg && !arg.startsWith('--')) {
    jsonPath = arg;
  }
}

// Paths
const baseDir = __dirname;
const partialsDir = path.join(baseDir, 'src', 'partials');
const cssSrcDir = path.join(baseDir, 'src', 'css');
const jsSrcDir = path.join(baseDir, 'src', 'js');
const outDir = path.join(baseDir, 'src', 'static', 'assets', 'widgets');
const cssOutDir = path.join(outDir, 'css');
const jsOutDir = path.join(outDir, 'js');

// Load partial template
const templatePath = path.join(partialsDir, `${partialName}.hbs`);
if (!fs.existsSync(templatePath)) {
  console.error(`❌ Partial not found: ${templatePath}`);
  process.exit(1);
}

// Register all partials
fs.readdirSync(partialsDir).forEach((file) => {
  if (file.endsWith('.hbs')) {
    const name = path.basename(file, '.hbs');
    const template = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    Handlebars.registerPartial(name, template);
  }
});

async function ensureRootVersion(context) {
  // Ensure the nested structure exists
  context.site = context.site || {};
  context.site.components = context.site.components || {};
  context.site.components.ROOT = context.site.components.ROOT || {};

  const rootComponent = context.site.components.ROOT;

  // Always hard-code the title
  rootComponent.title = 'Self-Managed';

  // Use env var if available
  const envVersion = process.env.LATEST_ENTERPRISE;
  if (envVersion) {
    rootComponent.latest = rootComponent.latest || {};
    rootComponent.latest.version = envVersion.trim();
    return;
  }

  // Fallback: the live docs site
  try {
    const remoteVersion = await fetchLatestVersion();
    rootComponent.latest = rootComponent.latest || {};
    rootComponent.latest.version = remoteVersion;
  } catch (err) {
    // Without a version the Bump widgets ship "Self-Managed v" as the search
    // tag and an empty latest-redpanda-version meta tag, so a release build
    // (CI) stops here. Locally it only warns, so the build works offline.
    if (process.env.CI) {
      console.error(`❌ Could not get the latest Redpanda version: ${err.message}. Set LATEST_ENTERPRISE to build without it.`);
      process.exit(1);
    }
    console.warn(`⚠️ Could not get the latest Redpanda version: ${err.message}`);
  }
}


(async () => {

  const templateSrc = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateSrc);
  const contextFromFile = jsonPath ? readJson(path.resolve(jsonPath)) : {};
  const context = {
    ...contextFromFile,
    env: {
      ALGOLIA_API_KEY: process.env.ALGOLIA_API_KEY,
      ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID,
      ALGOLIA_INDEX_NAME: process.env.ALGOLIA_INDEX_NAME,
    },
  };

  await ensureRootVersion(context);

  let html = template(context);

  // 🔽 Inject CSS if exists
  const allCssFiles = fs.readdirSync(cssSrcDir)
    .filter(f => f.endsWith('-bump.css') && f !== `${partialName}-bump.css`);

  allCssFiles.push(`${partialName}-bump.css`);

  const cssTags = [];

  fs.mkdirSync(cssOutDir, { recursive: true });

  allCssFiles.forEach(cssFile => {
    const srcPath = path.join(cssSrcDir, cssFile);
    const outPath = path.join(cssOutDir, cssFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, outPath);
      cssTags.push(`<link rel="stylesheet" href="/assets/widgets/css/${cssFile}">`);
    } else if (cssFile !== `${partialName}-bump.css`) {
      console.warn(`⚠️ Shared CSS not found: ${cssFile}`);
    }
  });

  if (partialName === 'head-bump') {
    // Prepend styles
    if (cssTags.length) {
      html = `${html}\n${cssTags.join('\n')}`;
    }
  }

  // 🔽 Inject JS scripts
  if (Array.isArray(jsScripts)) {
    fs.mkdirSync(jsOutDir, { recursive: true });

    const scriptTags = jsScripts.map((jsFile) => {
      const jsSrcPath = path.join(jsSrcDir, jsFile);
      const jsOutPath = path.join(jsOutDir, jsFile);

      if (fs.existsSync(jsSrcPath)) {
        fs.copyFileSync(jsSrcPath, jsOutPath);
        return `<script src="/assets/widgets/js/${jsFile}"></script>`;
      } else {
        console.warn(`⚠️ JavaScript not found: ${jsSrcPath}`);
        return '';
      }
    }).filter(Boolean).join('\n  ');

    if (scriptTags) {
      html = `${html}\n${scriptTags}`;
    }
  }

  // Output HTML
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${partialName}.html`);
  fs.writeFileSync(outFile, html);
})();