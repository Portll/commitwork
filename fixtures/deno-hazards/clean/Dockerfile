FROM denoland/deno:2.5.0
COPY . /app
CMD ["deno", "run", "--allow-net=0.0.0.0:8000", "--allow-read=/app/static", "/app/main.ts"]
