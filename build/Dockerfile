FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential gcc g++ make perl python3 \
	libncurses-dev zlib1g-dev libssl-dev rsync git wget unzip zstd \
	bc flex bison gawk gettext texinfo libelf-dev libtool autoconf \
	automake pkg-config file patch ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /work
CMD ["/bin/bash"]
