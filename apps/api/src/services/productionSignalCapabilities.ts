import { getGooglePlayOAuthConfig } from "./productionSignalOAuth.js";
/** Public availability projection only. Never returns or creates credentials. */
export function productionSignalCapabilities(env:NodeJS.ProcessEnv=process.env){
  const encryptedStorage=Boolean(env.PRODUCTION_SIGNAL_ENCRYPTION_KEY&&Buffer.from(env.PRODUCTION_SIGNAL_ENCRYPTION_KEY,"base64").length===32);
  let googleConfigured=false;try{googleConfigured=!!getGooglePlayOAuthConfig(env);}catch{/* Incomplete setup is unavailable, not a secret-bearing browser error. */}
  return {googlePlayConnectAvailable:encryptedStorage&&googleConfigured,appleConnectAvailable:encryptedStorage,automaticSyncAvailable:false as const};
}
