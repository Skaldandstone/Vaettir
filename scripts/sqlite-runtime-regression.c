/* Synthetic regression only. No application database or provider connection. */
#define _GNU_SOURCE 1
#ifdef VAETTIR_SQLITE_INTERNAL
#include "sqlite3.c"
#else
#include "sqlite3.h"
#endif
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define REQUIRE(x) do { if (!(x)) { fprintf(stderr,"SQLite regression failed at line %d\n",__LINE__); return 1; } } while(0)

#ifdef VAETTIR_SQLITE_INTERNAL
int main(void) {
  /* Exercise the actual internal WAL reader, not a copy of its implementation.
     A 512-byte frame must initialize the tail of a 4096-byte pager buffer.
     The old upstream control returns 42 only for the exact poisoned tail. */
  sqlite3_vfs *vfs;
  sqlite3_file *file;
  Wal wal;
  unsigned char data[512], output[4096];
  int flags = 0, rc, i;
  REQUIRE(sqlite3_initialize() == SQLITE_OK);
  vfs = sqlite3_vfs_find(NULL);
  REQUIRE(vfs != NULL);
  file = calloc(1, (size_t)vfs->szOsFile);
  REQUIRE(file != NULL);
  rc = vfs->xOpen(vfs, "wal-frame.bin", file,
      SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_EXCLUSIVE|SQLITE_OPEN_TEMP_JOURNAL, &flags);
  REQUIRE(rc == SQLITE_OK);
  memset(data, 0x3c, sizeof(data));
  REQUIRE(file->pMethods->xWrite(file, data, sizeof(data), 56) == SQLITE_OK);
  memset(&wal, 0, sizeof(wal));
  wal.hdr.szPage = 512;
  wal.pWalFd = file;
  memset(output, 0xa5, sizeof(output));
  rc = sqlite3WalReadFrame(&wal, 1, sizeof(output), output);
  REQUIRE(file->pMethods->xClose(file) == SQLITE_OK);
  free(file);
  REQUIRE(rc == SQLITE_OK && memcmp(output, data, sizeof(data)) == 0);
  for (i = 512; i < 4096 && output[i] == 0; ++i) {}
  if (i != 4096) {
    for (i = 512; i < 4096; ++i) REQUIRE(output[i] == 0xa5);
    puts("WAL_TAIL_UNINITIALIZED:3584");
    return 42;
  }
  puts("WAL_TAIL_ZEROED:3584");
  return 0;
}
#else
static int exec_ok(sqlite3 *db, const char *sql) {
  char *error = NULL;
  int rc = sqlite3_exec(db, sql, NULL, NULL, &error);
  if (rc != SQLITE_OK) fprintf(stderr, "%s\n", error ? error : "SQL failure");
  sqlite3_free(error);
  return rc == SQLITE_OK;
}

int main(int argc, char **argv) {
  sqlite3 *db = NULL;
  sqlite3_stmt *stmt = NULL;
  Dl_info library;
  int i, rc;
  char *sql, *cursor;
  const char *option;
  REQUIRE(dladdr((void *)sqlite3_libversion, &library) != 0);
  printf("VERSION=%s\nSOURCE_ID=%s\nLIBRARY=%s\n", sqlite3_libversion(), sqlite3_sourceid(), library.dli_fname);
  for (i = 0; (option = sqlite3_compileoption_get(i)) != NULL; ++i) printf("OPTION=%s\n", option);
  if (argc == 2 && strcmp(argv[1], "--identity") == 0) return 0;
  REQUIRE(argc == 1);
  REQUIRE(sqlite3_open(":memory:", &db) == SQLITE_OK);
  REQUIRE(exec_ok(db, "CREATE TABLE t(id INTEGER PRIMARY KEY,x); INSERT INTO t VALUES(1,'a'),(2,'b'),(3,'c');"
      "UPDATE t SET x='z' ORDER BY id LIMIT 1; DELETE FROM t ORDER BY id DESC LIMIT 1;"));
  REQUIRE(sqlite3_prepare_v2(db, "SELECT group_concat(id||x,',') FROM t ORDER BY id", -1, &stmt, NULL) == SQLITE_OK);
  REQUIRE(sqlite3_step(stmt) == SQLITE_ROW && strcmp((const char *)sqlite3_column_text(stmt,0), "1z,2b") == 0);
  REQUIRE(sqlite3_finalize(stmt) == SQLITE_OK);
  REQUIRE(exec_ok(db, "CREATE VIRTUAL TABLE ft USING fts5(x,detail=none);"
      "INSERT INTO ft(rowid,x) VALUES(-9223372036854775808,'abc'),(1,'ab');"
      "CREATE VIRTUAL TABLE rt USING rtree(id,a,b); INSERT INTO rt VALUES(1,0,1);"));
  REQUIRE(sqlite3_prepare_v2(db, "SELECT count(*) FROM ft('a*')", -1, &stmt, NULL) == SQLITE_OK);
  REQUIRE(sqlite3_step(stmt) == SQLITE_ROW && sqlite3_column_int(stmt,0) == 2);
  REQUIRE(sqlite3_finalize(stmt) == SQLITE_OK);
  /* Published count-of-view reproducer, bounded to 400000 rows / 4 MB.
     Reject the statement normally; crashes, timeouts and arbitrary errors fail. */
  sql = malloc(4000000);
  REQUIRE(sql != NULL);
  cursor = sql;
  cursor += sprintf(cursor, "WITH q AS (SELECT 1) SELECT count(*) FROM (VALUES ");
  for (i = 0; i < 400000; ++i) cursor += sprintf(cursor, "%s(%d)", i ? "," : "", i);
  strcpy(cursor, ");");
  rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
  free(sql);
  REQUIRE(rc == SQLITE_ERROR && stmt == NULL);
  REQUIRE(strstr(sqlite3_errmsg(db), "Expression tree is too large") != NULL);
  REQUIRE(sqlite3_close(db) == SQLITE_OK);
  puts("COUNT_VALUES_REJECTED:400000\nSQLITE_FUNCTIONAL_OK");
  return 0;
}
#endif
