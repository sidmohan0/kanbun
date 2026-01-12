FROM python:3.11-slim

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
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Firefox browser
RUN playwright install firefox
RUN playwright install-deps firefox

# Copy application code
COPY app/ ./app/

# Create data directories
RUN mkdir -p /data/screenshots

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
