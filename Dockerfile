FROM node:24.11.0-alpine

# Comment this out if you'd prefer to use the repo clone otherwise stick with this for development.
COPY . /app

# Use the original repo or replace with your own.
# RUN apk add --no-cache git
# RUN git clone https://github.com/scottpetrovic/mesh2motion-app.git /app

WORKDIR /app

RUN sed -i "s/open: !isCodeSandbox/open: false/" vite.config.js
RUN npm install

EXPOSE 3000

CMD ["npm", "run", "dev"]
