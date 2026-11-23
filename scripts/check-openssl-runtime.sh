#!/bin/sh
set -eu
mode=${1:?Specify packages or installed}
proof=/usr/share/vaettir/openssl/artifact-sha256.txt
verify() {
  expected=''
  while IFS=' ' read -r checksum source_path; do
    if [ "$source_path" = "$1" ]; then
      test -z "$expected"
      expected=$checksum
    fi
  done < "$proof"
  test "${#expected}" -eq 64
  printf '%s  %s\n' "$expected" "$2" | sha256sum --check
}
case "$mode" in
  packages)
    for package in openssl libssl3t64 openssl-provider-legacy; do
      file="${package}_3.5.9-1~deb13u1+vaettir1_amd64.deb"
      verify "/build/native/packages/$file" "/tmp/vaettir-openssl/$file"
    done
    ;;
  installed)
    for package in openssl libssl3t64 openssl-provider-legacy; do
      test "$(dpkg-query -W -f='${Version}' "$package")" = '3.5.9-1~deb13u1+vaettir1'
    done
    verification=$(dpkg --verify openssl libssl3t64 openssl-provider-legacy)
    test -z "$verification"
    for lib in libcrypto.so.3 libssl.so.3; do
      verify "/build/native/extracted/usr/lib/x86_64-linux-gnu/$lib" "/usr/lib/x86_64-linux-gnu/$lib"
    done
    openssl version | grep '^OpenSSL 3\.5\.9 '
    ;;
  *) exit 2 ;;
esac
