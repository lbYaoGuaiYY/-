FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY deploy/asset-cloud/pyproject.toml deploy/asset-cloud/uv.lock ./
RUN uv sync --frozen --no-dev

COPY tools ./tools
COPY dist-asset-admin ./admin
RUN mkdir -p /app/admin/downloads
COPY browser-extension/qingshe-image-archive-chrome.zip ./admin/downloads/qingshe-image-archive-chrome.zip
COPY browser-extension/qingshe-image-archive-firefox.xpi ./admin/downloads/qingshe-image-archive-firefox.xpi

EXPOSE 7000

CMD [".venv/bin/uvicorn", "tools.asset_admin.cloud_server:create_app", "--factory", "--host", "0.0.0.0", "--port", "7000", "--workers", "1"]
