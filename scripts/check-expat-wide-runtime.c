/* Network-free ABI/Unicode regression for Debian's unsigned-short Expat API.
 * Upstream's wchar_t-only test harness cannot test this shipped UTF-16 ABI. */
#define XML_UNICODE 1
#include <expat.h>
#include <stdio.h>
#include <string.h>

_Static_assert(sizeof(XML_Char) == 2, "Debian UTF-16 ABI must remain unchanged");

struct fixture {
  int starts;
  int ends;
  int invalid;
  int length;
  XML_Char text[3];
};

static void XMLCALL start(void *data, const XML_Char *name,
                         const XML_Char **attributes) {
  struct fixture *result = data;
  const XML_Char expected[] = {'f', 0};
  (void)attributes;
  result->starts++;
  if (memcmp(name, expected, sizeof(expected)) != 0)
    result->invalid = 1;
}

static void XMLCALL end(void *data, const XML_Char *name) {
  struct fixture *result = data;
  const XML_Char expected[] = {'f', 0};
  result->ends++;
  if (memcmp(name, expected, sizeof(expected)) != 0)
    result->invalid = 1;
}

static void XMLCALL characters(void *data, const XML_Char *text, int length) {
  struct fixture *result = data;
  if (length < 0 || length > 3 - result->length) {
    result->invalid = 1;
    return;
  }
  memcpy(result->text + result->length, text, (size_t)length * sizeof(XML_Char));
  result->length += length;
}

int main(void) {
  /* UTF-16LE BOM, <f>, U+00E9 and U+1F600 surrogate pair, </f>. */
  const unsigned char valid[] = {0xff, 0xfe, '<', 0, 'f', 0, '>', 0, 0xe9, 0,
                                0x3d, 0xd8, 0, 0xde, '<', 0, '/', 0, 'f', 0,
                                '>', 0};
  const unsigned char invalid[] = {0xff, 0xfe, '<', 0, 'f', 0, '>', 0,
                                  0x3d, 0xd8, 'a', 0, '<', 0, '/', 0,
                                  'f', 0, '>', 0};
  const XML_Char expected[] = {0xe9, 0xd83d, 0xde00};
  struct fixture result = {0};
  XML_Parser parser = XML_ParserCreate(NULL);
  if (parser == NULL)
    return 1;
  XML_SetUserData(parser, &result);
  XML_SetElementHandler(parser, start, end);
  XML_SetCharacterDataHandler(parser, characters);
  int ok = XML_Parse(parser, (const char *)valid, (int)sizeof(valid), 1)
               == XML_STATUS_OK
           && result.starts == 1 && result.ends == 1 && result.invalid == 0
           && result.length == 3
           && memcmp(result.text, expected, sizeof(expected)) == 0;
  XML_ParserFree(parser);
  if (!ok)
    return 1;
  parser = XML_ParserCreate(NULL);
  if (parser == NULL)
    return 1;
  ok = XML_Parse(parser, (const char *)invalid, (int)sizeof(invalid), 1)
           == XML_STATUS_ERROR
       && XML_GetErrorCode(parser) == XML_ERROR_INVALID_TOKEN;
  XML_ParserFree(parser);
  if (!ok || strcmp(XML_ExpatVersion(), "expat_2.8.5") != 0)
    return 1;
  puts("Expat wide UTF-16 ABI and surrogate validation verified");
  return 0;
}
