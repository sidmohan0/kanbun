const configuration = require("./electron-builder.json");
const notarization = globalThis.process.env.KANBUN_MAC_NOTARIZE;

if (notarization !== "true" && notarization !== "false") {
  throw new Error("Set KANBUN_MAC_NOTARIZE to true or false when packaging macOS.");
}

configuration.mac.notarize = notarization === "true";
configuration.forceCodeSigning = notarization === "true";

module.exports = configuration;
