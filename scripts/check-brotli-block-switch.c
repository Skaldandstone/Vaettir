/* Synthetic regression from nodejs/node a18ec92752, CVE-2026-111497.
 * No customer input, network access, or unbounded decompression. */
#include <brotli/decode.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static const uint8_t invalid[] = {
  0x20,0x00,0x10,0x41,0x41,0x41,0xfc,0xff,0xff,0x07,0x00,
  0x22,0x28,0xf0,0x0b,0x60,0xf7,0xf4,0x1f,0x00,0x00,0x00
};

static int check(int one_byte) {
  BrotliDecoderState *state=BrotliDecoderCreateInstance(NULL,NULL,NULL);
  if(!state) return 3;
  uint8_t output[256];size_t produced=0;BrotliDecoderResult result=BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT;
  size_t offset=0;
  while(offset<sizeof invalid&&result!=BROTLI_DECODER_RESULT_ERROR){
    size_t count=one_byte?1:sizeof invalid;
    const uint8_t *next_in=invalid+offset;size_t available_in=count,available_out=sizeof output;
    uint8_t *next_out=output;
    result=BrotliDecoderDecompressStream(state,&available_in,&next_in,&available_out,&next_out,&produced);
    if(available_in>count||produced>sizeof output||result==BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT){BrotliDecoderDestroyInstance(state);return 4;}
    offset+=count-available_in;
    if(available_in&&result!=BROTLI_DECODER_RESULT_ERROR)break;
  }
  int error=(int)BrotliDecoderGetErrorCode(state);
  BrotliDecoderDestroyInstance(state);
  if(result!=BROTLI_DECODER_RESULT_ERROR||error!=-17){fprintf(stderr,"BROTLI_BLOCK_SWITCH_REJECTED result=%d error=%d mode=%s\n",(int)result,error,one_byte?"byte":"whole");return 42;}
  return 0;
}
int main(void){int result=check(0);if(result)return result;result=check(1);if(result)return result;puts("BROTLI_BLOCK_SWITCH_PASS whole-and-byte-stream error=-17 bounded-output=256");return 0;}
