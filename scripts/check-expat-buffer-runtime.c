/* CVE-2026-77214: test both the narrow and wide installed ABIs. */
#include <expat.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  for (int final = 0; final < 2; final++) {
    XML_Parser parser = XML_ParserCreate(NULL);
    if (!parser) return 1;
    if (XML_ParseBuffer(parser, 10, final) != XML_STATUS_ERROR ||
        XML_GetErrorCode(parser) != XML_ERROR_NO_BUFFER) return 2;
    void *buffer = XML_GetBuffer(parser, 10);
    if (!buffer) return 3;
    if (XML_ParseBuffer(parser, 10000, final) != XML_STATUS_ERROR ||
        XML_GetErrorCode(parser) != XML_ERROR_INVALID_ARGUMENT) return 4;
    memcpy(buffer, "<r></r>", 7);
    if (XML_ParseBuffer(parser, 7, XML_FALSE) != XML_STATUS_OK) return 5;
    if (XML_ParseBuffer(parser, 10000, final) != XML_STATUS_ERROR ||
        XML_GetErrorCode(parser) != XML_ERROR_INVALID_ARGUMENT) return 6;
    XML_ParserFree(parser);
  }
  if (strcmp(XML_ExpatVersion(), "expat_2.9.0") != 0) return 7;
  puts("Expat 2.9.0 buffer bounds and valid streaming regression passed");
  return 0;
}
