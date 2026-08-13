ARG PYTHON_IMAGE=docker.m.daocloud.io/library/python:3.11-slim
FROM ${PYTHON_IMAGE}

WORKDIR /app

RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
      -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
      /etc/apt/sources.list.d/debian.sources

RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      if apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update \
        && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -f install -y --fix-missing \
        && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --fix-missing --no-install-recommends \
        ca-certificates curl fonts-noto-cjk xvfb xauth x11vnc \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir \
      --index-url https://mirrors.aliyun.com/pypi/simple/ \
      --trusted-host mirrors.aliyun.com \
      --retries 10 --timeout 120 \
      -r requirements.txt \
    && pip check

RUN mkdir -p /opt/novnc \
    && curl -fsSL --retry 5 --retry-all-errors \
      https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz \
      | tar -xz -C /opt/novnc --strip-components=1

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      if python -m playwright install chromium --no-shell; then break; fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep 5; \
    done; \
    chmod -R 755 /ms-playwright

COPY app ./app
COPY start.sh ./start.sh
COPY healthcheck.sh ./healthcheck.sh

RUN useradd -m -u 1001 appuser \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && mkdir -p /data/synapse/cookies \
    && chmod 755 /app/start.sh /app/healthcheck.sh \
    && chown -R appuser:appuser /app /data /ms-playwright

USER appuser
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD ["/app/healthcheck.sh"]

CMD ["/app/start.sh"]
