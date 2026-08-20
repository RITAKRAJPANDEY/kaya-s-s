# Python FastAPI & YOLO Backend Dockerfile
FROM python:3.12-slim

# Install system libraries required by OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --default-timeout=1000 --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "main.py", "--no-display"]
