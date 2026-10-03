#define _POSIX_C_SOURCE 200809L
#include <zlib.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define REQUIRE(condition) do { if (!(condition)) { fprintf(stderr, "zlib regression failed at line %d\n", __LINE__); exit(1); } } while (0)

/* No imported application code or external files: bounded synthetic bytes only. */
static void nonblocking(void) {
    int descriptors[2];
    REQUIRE(pipe(descriptors) == 0);
    REQUIRE(fcntl(descriptors[0], F_SETFL, O_NONBLOCK) == 0);
    REQUIRE(fcntl(descriptors[1], F_SETFL, O_NONBLOCK) == 0);
    unsigned char fill[4096];
    memset(fill, 'f', sizeof(fill));
    ssize_t wrote;
    size_t filled = 0;
    while ((wrote = write(descriptors[1], fill, sizeof(fill))) > 0) {
        filled += (size_t)wrote;
        REQUIRE(filled <= 1048576);
    }
    REQUIRE(wrote == -1 && (errno == EAGAIN || errno == EWOULDBLOCK));
    gzFile file = gzdopen(descriptors[1], "wTN");
    REQUIRE(file != NULL && gzbuffer(file, 32) == 0);
    unsigned char *external = malloc(65536);
    REQUIRE(external != NULL);
    memset(external, 'x', 65536);
    REQUIRE(gzwrite(file, external, 65536) == 0);
    int error = Z_OK;
    (void)gzerror(file, &error);
    REQUIRE(error == Z_ERRNO && (errno == EAGAIN || errno == EWOULDBLOCK));
    free(external);
    /* The old branch retains external next_in/avail_in. This retry must use
       the internal buffer, never the released caller-owned buffer. */
    REQUIRE(gzwrite(file, "a", 1) == 1);
    gzclearerr(file);
    REQUIRE(gzprintf(file, "%s", "b") == 1);
    size_t drained = 0;
    ssize_t count;
    while ((count = read(descriptors[0], fill, sizeof(fill))) > 0) {
        drained += (size_t)count;
        REQUIRE(drained <= 1048576);
    }
    REQUIRE(drained == filled && count == -1 && errno == EAGAIN);
    REQUIRE(gzflush(file, Z_SYNC_FLUSH) == Z_OK);
    REQUIRE(gzclose(file) == Z_OK);
    unsigned char recovered[8];
    REQUIRE(read(descriptors[0], recovered, sizeof(recovered)) == 2);
    REQUIRE(memcmp(recovered, "ab", 2) == 0);
    REQUIRE(close(descriptors[0]) == 0);
    puts("nonblocking EAGAIN, released caller buffer, retry, gzclearerr and gzprintf passed");
}

static void post_error(void) {
    int fd = open("/dev/full", O_WRONLY);
    REQUIRE(fd >= 0);
    gzFile file = gzdopen(fd, "wT");
    REQUIRE(file != NULL && gzbuffer(file, 32) == 0);
    unsigned char *external = malloc(4096);
    REQUIRE(external != NULL);
    memset(external, 'e', 4096);
    REQUIRE(gzwrite(file, external, 4096) == 0);
    int error = Z_OK;
    (void)gzerror(file, &error);
    REQUIRE(error == Z_ERRNO);
    free(external);
    REQUIRE(gzwrite(file, "ignored", 7) == 0);
    gzclearerr(file);
    REQUIRE(gzwrite(file, "c", 1) == 1);
    REQUIRE(gzprintf(file, "%s", "d") == 1);
    REQUIRE(gzclose(file) == Z_ERRNO);
    puts("hard write error rejection and explicit gzclearerr recovery passed");
}

static void roundtrip(void) {
    unsigned char input[65536], compressed[70000], output[65536];
    unsigned value = 12345;
    for (size_t i = 0; i < sizeof(input); i++) {
        value = value * 1664525U + 1013904223U;
        input[i] = (unsigned char)(value >> 24);
    }
    uLongf length = sizeof(compressed), restored = sizeof(output);
    REQUIRE(compress2(compressed, &length, input, sizeof(input), Z_DEFAULT_COMPRESSION) == Z_OK);
    REQUIRE(uncompress(output, &restored, compressed, length) == Z_OK);
    REQUIRE(restored == sizeof(input) && memcmp(input, output, restored) == 0);
    char path[] = "/tmp/vaettir-zlib-XXXXXX";
    int fd = mkstemp(path);
    REQUIRE(fd >= 0);
    gzFile file = gzdopen(fd, "wb");
    REQUIRE(file != NULL && gzbuffer(file, 64) == 0);
    REQUIRE(gzwrite(file, input, sizeof(input)) == sizeof(input));
    REQUIRE(gzprintf(file, "%s", "footer") == 6);
    REQUIRE(gzclose(file) == Z_OK);
    file = gzopen(path, "rb");
    REQUIRE(file != NULL);
    REQUIRE(gzread(file, output, sizeof(output)) == sizeof(output));
    REQUIRE(memcmp(output, input, sizeof(input)) == 0);
    unsigned char footer[8];
    REQUIRE(gzread(file, footer, sizeof(footer)) == 6 && memcmp(footer, "footer", 6) == 0);
    REQUIRE(gzclose(file) == Z_OK && unlink(path) == 0);
    REQUIRE(strcmp(zlibVersion(), "1.3.2") == 0);
    puts("gzip and zlib incompressible round trips and runtime version passed");
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--nonblocking") == 0) { nonblocking(); return 0; }
    REQUIRE(argc == 1);
    nonblocking(); post_error(); roundtrip();
    return 0;
}
