FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if any (none needed for basic fallback)
# RUN apt-get update && apt-get install -y --no-install-recommends ...

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
# We copy everything in the directory to /app
COPY . .

# Set unbuffered output for better logs
ENV PYTHONUNBUFFERED=1

# Create a non-root user
RUN useradd -r -u 1000 appuser && chown -R appuser /app
USER 1000

# Run the entrypoint
CMD ["python", "entrypoint.py"]
