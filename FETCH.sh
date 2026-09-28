#!/bin/bash
cd /public/AVODAH-NETWORK/repos/HEAVENLY-OS/sources
echo "FETCHING TOP-NOTCH - NO DIME - HEAVENLY-OS"
[ -f linux-6.6.tar.xz ] || curl -L https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.tar.xz -o linux-6.6.tar.xz && echo "KERNEL DONE"
[ -f busybox.tar.bz2 ] || curl -L https://busybox.net/downloads/busybox-1.36.1.tar.bz2 -o busybox.tar.bz2 && echo "BUSYBOX DONE"
[ -d buildroot ] || git clone --depth 1 https://gitlab.com/buildroot.org/buildroot.git buildroot && echo "BUILDROOT DONE"
ls -lh && echo "ALL MATERIALS AT FINGERTIPS - READY TO BUILD"
