module.exports = {
  apps: [
    {
      name: 'chatbot-movilidad-urbana',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
