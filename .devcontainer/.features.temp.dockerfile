FROM devcontainer-app:latest
COPY --from=jb-devcontainer-features-2c36ebf97c8fb57ff13e22a021e5f1d3 /tmp/jb-devcontainer-features /tmp/jb-devcontainer-features/
ENV PATH="/usr/local/share/nvm/current/bin:/usr/local/share/npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV NODE_VERSION="24.7.0"
ENV YARN_VERSION="1.22.22"
ENV NVM_DIR="/usr/local/share/nvm"
ENV NVM_SYMLINK_CURRENT="true"
ENV _CONTAINER_USER="root"
ENV _CONTAINER_USER_HOME="/root"
ENV _REMOTE_USER="node"
ENV _REMOTE_USER_HOME="/home/node"

USER root
RUN chmod -R 0755 /tmp/jb-devcontainer-features/ghcr.io-devcontainers-features-azure-cli-1 \
&& cd /tmp/jb-devcontainer-features/ghcr.io-devcontainers-features-azure-cli-1 \
&& chmod +x ./devcontainer-feature-setup.sh \
&& ./devcontainer-feature-setup.sh
USER root
RUN chmod -R 0755 /tmp/jb-devcontainer-features/ghcr.io-flexwie-devcontainer-features-pulumi-1 \
&& cd /tmp/jb-devcontainer-features/ghcr.io-flexwie-devcontainer-features-pulumi-1 \
&& chmod +x ./devcontainer-feature-setup.sh \
&& ./devcontainer-feature-setup.sh