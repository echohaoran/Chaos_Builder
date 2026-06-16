FROM node:20-bookworm-slim

# 换源:清华 TUNA 镜像(国内服务器 build 必备,默认 deb.debian.org 太慢)
# bookworm-slim 用新格式源 /etc/apt/sources.list.d/debian.sources,带 Signed-By
# 只 sed 替换 URIs,保持 Signed-By / Suites / Components 完整(Signed-By 走官方 keyring,TUNA 镜像兼容)
RUN sed -i \
        -e 's|deb.debian.org/debian|mirrors.tuna.tsinghua.edu.cn/debian|g' \
        -e 's|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ git ca-certificates curl docker.io && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    # 让 git 不报 "dubious ownership"(容器内 user 跟宿主机 .git owner 不一致)
    git config --global --add safe.directory /app && \
    git config --global --add safe.directory '*' && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
