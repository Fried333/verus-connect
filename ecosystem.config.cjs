// PM2 ecosystem config for verus-connect
// Usage: pm2 start ecosystem.config.cjs

module.exports = {
  apps: [{
    name: 'verus-connect',
    script: 'node_modules/.bin/verus-connect',
    args: 'start',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
    },
    // Restart on crash, max 10 restarts in 1 minute
    max_restarts: 10,
    min_uptime: '10s',
    // Watch .env for config changes (optional)
    watch: ['.env'],
    watch_delay: 1000,
  }],
};
