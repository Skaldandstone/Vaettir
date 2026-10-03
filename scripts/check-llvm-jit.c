/* Authored, fixed-input smoke check of the shipped LLVM native CPU JIT.
 * LLVM 19.1 C API: llvm-c/{Core,Analysis,ExecutionEngine,Target}.h.
 * No files, caller IR, command-line input, environment or network are read.
 * This is CPU code-generation evidence, not Mesa rendering acceptance. */
#include <llvm-c/Analysis.h>
#include <llvm-c/Core.h>
#include <llvm-c/ExecutionEngine.h>
#include <llvm-c/Target.h>
#include <stdint.h>
#include <stdio.h>

int main(void) {
  LLVMContextRef context = NULL;
  LLVMModuleRef module = NULL;
  LLVMBuilderRef builder = NULL;
  LLVMExecutionEngineRef engine = NULL;
  char *error = NULL;
  int result = 1;

  LLVMLinkInMCJIT();
  if (LLVMInitializeNativeTarget() || LLVMInitializeNativeAsmPrinter()) {
    fputs("LLVM native target initialization failed\n", stderr);
    return 1;
  }
  context = LLVMContextCreate();
  module = LLVMModuleCreateWithNameInContext("vaettir_authored_add", context);
  builder = LLVMCreateBuilderInContext(context);
  LLVMTypeRef integer = LLVMInt32TypeInContext(context);
  LLVMTypeRef parameters[] = {integer, integer};
  LLVMTypeRef signature = LLVMFunctionType(integer, parameters, 2, 0);
  LLVMValueRef function = LLVMAddFunction(module, "vaettir_add", signature);
  LLVMBasicBlockRef entry = LLVMAppendBasicBlockInContext(context, function, "entry");
  LLVMPositionBuilderAtEnd(builder, entry);
  LLVMBuildRet(builder, LLVMBuildAdd(builder, LLVMGetParam(function, 0),
                                  LLVMGetParam(function, 1), "sum"));
  LLVMDisposeBuilder(builder);
  builder = NULL;
  if (LLVMVerifyModule(module, LLVMReturnStatusAction, &error)) {
    fputs("Authored LLVM module verification failed\n", stderr);
    goto cleanup;
  }
  LLVMDisposeMessage(error);
  error = NULL;
  struct LLVMMCJITCompilerOptions options;
  LLVMInitializeMCJITCompilerOptions(&options, sizeof(options));
  options.OptLevel = 0;
  /* Matching LLVM 19 headers/DSO: the builder consumes the module even if
   * engine creation fails. Do not double-dispose it on that failure path. */
  LLVMModuleRef transferred = module;
  module = NULL;
  if (LLVMCreateMCJITCompilerForModule(&engine, transferred, &options,
                                     sizeof(options), &error)) {
    fputs("LLVM MCJIT creation failed\n", stderr);
    goto cleanup;
  }
  uint64_t address = LLVMGetFunctionAddress(engine, "vaettir_add");
  if (!address || LLVMExecutionEngineGetErrMsg(engine, &error)) {
    fputs("LLVM authored function materialization failed\n", stderr);
    goto cleanup;
  }
  /* Native amd64 fixture only; parameters ensure the add reaches codegen. */
  int32_t (*add)(int32_t, int32_t) = (int32_t (*)(int32_t, int32_t))(uintptr_t)address;
  if (add(4, 7) != 11) {
    fputs("LLVM authored integer result mismatch\n", stderr);
    goto cleanup;
  }
  puts("VAETTIR_LLVM_CPU_JIT_ADD_4_7=11");
  result = 0;

cleanup:
  if (error) LLVMDisposeMessage(error);
  if (builder) LLVMDisposeBuilder(builder);
  if (engine) LLVMDisposeExecutionEngine(engine);
  if (module) LLVMDisposeModule(module);
  if (context) LLVMContextDispose(context);
  return result;
}
