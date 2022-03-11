FROM clojure:latest

# this setup was taken from: https://github.com/exercism/clojurescript-test-runner/blob/cdb72f6a3912d3bf3f308c9598bc3dee36a3e6fd/Dockerfile#L3
RUN apt-get update && \
    apt-get install -y curl jq && \ 
    curl -fsSL https://deb.nodesource.com/setup_15.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get purge --auto-remove && \
    apt-get clean

# adding this as suggested here: https://clojurescript.org/guides/quick-start#running-clojurescript-on-node.js
RUN npm install source-map-support
RUN npm install -g nbb@0.2.4

WORKDIR /code

COPY . /code
