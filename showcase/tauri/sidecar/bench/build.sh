#!/bin/bash
# Builds the two small programs the measuring tools use: host (a stand-in for the shell: the overlay page in a
# WebKit view, with the memory of its processes) and fp (the memory of a process by id). They are not committed.
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O -o host host.swift
swiftc -O -o fp fp.swift
