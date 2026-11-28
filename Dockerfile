FROM denoland/deno:2.5.6

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno cache src/main.ts

COPY src/ ./src/
COPY tests/ ./tests/

ENV PORT=8000
ENV DATABASE_URL=file:./tasks.db

EXPOSE 8000

CMD ["deno", "task", "start"]