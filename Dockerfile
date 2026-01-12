FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system dependencies for Playwright Firefox
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libasound2 \
    libgdk-pixbuf2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libfontconfig1 \
    fonts-liberation \
    xfonts-base \
    xfonts-scalable \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Firefox browser (skip install-deps, we handled it above)
RUN playwright install firefox

# Copy application code
COPY app/ ./app/

# Create data directories
RUN mkdir -p /data/screenshots

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
