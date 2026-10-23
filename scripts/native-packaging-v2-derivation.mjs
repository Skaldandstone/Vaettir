// PURE draft derivation of exact root-reviewed public sources, not a loader,
// writer, archive exporter, native gate, cloud route or executable acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
const sha=b=>createHash("sha256").update(b).digest("hex");
const decoder=new TextDecoder("utf-8",{fatal:true});
export const LEGACY_SOURCE_PINS=Object.freeze({
  "native-builder-fresh-prepare.mjs":"5065ad5f7a2c32ceb10518d569fe5655df27d23a19af0e69a59f3e23fff4c273",
  "native-builder-fresh-core.mjs":"6da01035ffc5a2cf5043db850254ec89974649d57c8d3491a47a91d03744d5df",
  "native-builder-fresh-next-phase.mjs":"4a3e51b31ea7afaff928ec95862b383eade524b99ede0efe6745a65e403a1642",
  "native-builder-fresh-final-plan.mjs":"aa57331900911078457f44716b86b121f44bb45360cb90d02ac9ecb96b8b843e",
  "native-builder-fresh-final-adapter.mjs":"5b0e360140ac894f81d62ce4aaf552fd58e85df4b880d13e16c4de3a3050d21b",
  "native-builder-fresh-final-verifier.mjs":"3485c951647c08da77994f73389ccc48654e6148dd539d49fca06269e607a2ff",
  "native-builder-recovery.mjs":"c6cfa748761c4516978f842f0189669b835827727f18a3edd37b423a5ef3b660",
  "native-builder-continuation.mjs":"2cb81d497874f56f421c0ab074cfd1d4d4c1d026b8903925e217dbe4438e1748",
  "native-final-runtime-recipe-validation.mjs":"7db7c660cfc0deb13790dbb0edeaf02c604629370471070b3b4a8e795f47f69d",
  "native-final-runtime-recipe.mjs":"a837cb53dfbb2afc3ed69953d19200872c86a38be19877151932bb5952996e32",
});
export const V2_MODULE_NAMES=Object.freeze(Object.fromEntries([
  "native-builder-fresh-prepare.mjs","native-builder-fresh-core.mjs",
  "native-builder-fresh-next-phase.mjs","native-builder-fresh-final-plan.mjs",
  "native-final-runtime-recipe-validation.mjs","native-final-runtime-recipe.mjs",
].map(n=>[n,"native-packaging-v2-"+n.slice("native-".length)])));
const oldRecipeHash="c5c97e29d3722314faf2d09cda17a495972df30ab003ac55e80b6d18f308a0b9";
const oldRecipeCrlfHash="01ec2b844b6c5a09417dd25bd47074a73119ffd6059cd11b3dd437eedaf541bc";
const oldSourceCommit="3ce9a23715386059765ed221351de1f3bd9aa3bb";
const oldLine="dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -P\"$root\" -O\"$root/DEBIAN/control\"";
const newLine="dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -Tdebian/libllvm19.substvars -f/build/libllvm19.files -P\"$root\" -O\"$root/DEBIAN/control\"";
const purpose={
  "native-builder-fresh-prepare.mjs":["fresh-native-prepare-not-runtime","native-packaging-v2-fresh-prepare-not-runtime"],
  "native-builder-fresh-core.mjs":["fresh-native-core-not-runtime","native-packaging-v2-fresh-core-not-runtime"],
  "native-builder-fresh-next-phase.mjs":["fresh-native-next-phase-not-runtime","native-packaging-v2-fresh-next-phase-not-runtime"],
  "native-builder-fresh-final-plan.mjs":["fresh-native-final-plan-not-runtime","native-packaging-v2-fresh-final-plan-not-runtime"],
};
function exact(x,keys){assert.ok(x&&typeof x==="object"&&!Array.isArray(x));assert.deepEqual(Object.keys(x).sort(),[...keys].sort());}
/** Inputs must be the exact ORIGINAL whole public modules and original LF
 * recipe, independently canonical-root/hash verified before caller import.
 * No caller patches, arbitrary module names, hashes or substitutions accepted.
 * Generated buffers are NOT a canonical Git ZIP. Root must separately apply
 * reviewed real recipe changes, checkpoint/export actual Git, and verify the
 * new archive includes this exact corrected recipe as its normal native9 file.
 */
export function deriveNativePackagingV2(input){
  exact(input,["recipe","modules"]);exact(input.modules,Object.keys(LEGACY_SOURCE_PINS));
  assert.ok(Buffer.isBuffer(input.recipe)&&input.recipe.length<=65536);
  assert.equal(sha(input.recipe),oldRecipeHash);
  const originalRecipe=decoder.decode(input.recipe);
  assert.equal(originalRecipe.includes("\r"),false);
  assert.equal(originalRecipe.split(oldLine).length,2);
  const correctedRecipe=Buffer.from(originalRecipe.replace(oldLine,newLine));
  assert.deepEqual(Buffer.from(decoder.decode(correctedRecipe).replace(newLine,oldLine)),input.recipe);
  const correctedLFHash=sha(correctedRecipe),correctedCrlfHash=sha(decoder.decode(correctedRecipe).replaceAll("\n","\r\n"));
  let total=0;const modules={},changes=[];
  for(const [name,pin]of Object.entries(LEGACY_SOURCE_PINS)){
    const raw=input.modules[name];assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=131072);total+=raw.length;
    assert.ok(total<=512*1024);assert.equal(sha(raw),pin,"Only exact frozen v1 public module bytes may be derived");
    let text=decoder.decode(raw);const edits=[];
    const change=(before,after,count)=>{
      const found=text.split(before).length-1;
      assert.equal(found,count,"Exact fixed derivation anchor count required");
      text=text.replaceAll(before,after);edits.push({before,after,count});
    };
    if(name==="native-builder-fresh-prepare.mjs"){
      change(oldRecipeHash,correctedLFHash,1);
      change(oldRecipeCrlfHash,correctedCrlfHash,1);
      // Refuse actual legacy3ce origin before any v2 plan/result operation.
      // These are the only two source-commit admission anchors in v1.
      const id="  assert.notEqual(identity.sourceCommit, oldCommit);";
      change(id,id+`\n  assert.notEqual(identity.sourceCommit, "${oldSourceCommit}", "Corrected packaging requires a distinct canonical source commit");`,1);
      const inp="  assert.match(input.archiveSha256, hex);";
      change(inp,`  assert.notEqual(input.sourceCommit, "${oldSourceCommit}", "Corrected packaging requires a distinct canonical source commit");\n`+inp,1);
    }
    if(purpose[name]){
      const[before,after]=purpose[name];
      const count=text.split('"'+before+'"').length-1;
      assert.ok(count===1||count===2);
      change('"'+before+'"','"'+after+'"',count);
    }
    // Only STATIC import specifiers are changed. Capsule members intentionally
    // retain universal v1 adapter/verifier names and exact bytes; the capsule
    // is external to native9 and full final verification uses actual v2 pins.
    for(const[before,after]of Object.entries(V2_MODULE_NAMES)){
      const from='from "./'+before+'"';
      const count=text.split(from).length-1;
      if(count)change(from,'from "./'+after+'"',count);
    }
    let restored=text;
    for(const e of [...edits].reverse()){
      assert.equal(restored.split(e.after).length-1,e.count);
      restored=restored.replaceAll(e.after,e.before);
    }
    assert.deepEqual(Buffer.from(restored),raw,"Every unchanged v1 byte must reconstruct exactly");
    const destination=V2_MODULE_NAMES[name]??name;
    modules[destination]=Buffer.from(text);
    changes.push({originalName:name,destination,originalSha256:pin,derivedSha256:sha(modules[destination]),edits});
  }
  return{schemaVersion:2,purpose:"native-packaging-v2-source-derivation-NOT-executed",correctedRecipe,modules,changes,
    policy:{recipeGitPath:"scripts/build-llvm-runtime.sh",originalRecipeSha256:oldRecipeHash,correctedRecipeLFHash:correctedLFHash,correctedRecipeCRLFHash:correctedCrlfHash,
      filesList:"/build/libllvm19.files",substitutionFile:"/build/llvm-source/debian/libllvm19.substvars",originalDockerfileUnchanged:true,
      freshNullParentRequired:true,legacyReceiptsNeverRewritten:true,cacheImportSupported:false,exclusionsChanged:false},
    acceptance:{sourceIntegrated:false,nativeAccepted:false,unitAccepted:false,packageAccepted:false,runtimeAccepted:false,deploymentAccepted:false}};
}
