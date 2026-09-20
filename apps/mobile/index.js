// Explicit app entry. Under pnpm, expo's default `node_modules/expo/AppEntry.js`
// resolves `../../App` relative to its real path inside the virtual store, not
// this package, so the root component must be registered from here.
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
