FROM nginx:alpine

# Copy static files to nginx html directory
COPY . /usr/share/nginx/html

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

# Configure nginx to listen on port 8080
RUN sed -i 's/listen\(.*\)80;/listen 8080;/' /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
