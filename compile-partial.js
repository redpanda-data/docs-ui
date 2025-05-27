const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const helpersDir = path.join(__dirname, 'src', 'helpers');
if (fs.existsSync(helpersDir)) {
  fs.readdirSync(helpersDir).forEach((file) => {
    if (file.endsWith('.js')) {
      const name = path.basename(file, '.js');
      const helperFn = require(path.join(helpersDir, file));
      Handlebars.registerHelper(name, helperFn);
    }
  });
}

/**
 * Reads and parses a JSON file from the specified path.
 *
 * If the file cannot be read or parsed, returns an empty object.
 *
 * @param {string} filepath - Path to the JSON file.
 * @returns {Object} The parsed JSON object, or an empty object if reading or parsing fails.
 */
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
const [partialName, jsonPath] = args;

if (!partialName) {
  console.error('❌ Usage: node compile-partial.js <partial-name> [context.json]');
  process.exit(1);
}

// Register all partials in src/partials/
const partialsDir = path.join(__dirname, 'src', 'partials');
fs.readdirSync(partialsDir).forEach(file => {
  if (file.endsWith('.hbs')) {
    const name = path.basename(file, '.hbs');
    const template = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    Handlebars.registerPartial(name, template);
  }
});

// Load and compile the requested partial
const templatePath = path.join(partialsDir, `${partialName}.hbs`);
if (!fs.existsSync(templatePath)) {
  console.error(`❌ Partial not found: ${templatePath}`);
  process.exit(1);
}

const templateSrc = fs.readFileSync(templatePath, 'utf8');
const template = Handlebars.compile(templateSrc);
const context = jsonPath ? readJson(path.resolve(jsonPath)) : {};

const html = template(context);

// Write to assets
const outDir = path.join(__dirname, 'src', 'static', 'assets', 'widgets');
const outFile = path.join(outDir, `${partialName}.html`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);

console.log(`✅ Compiled '${partialName}.hbs' to '${outFile}'`);
