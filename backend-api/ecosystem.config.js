/**
 * PM2 Ecosystem Configuration
 * High-Concurrency Cluster Mode for VPS Deployments
 *
 * This configuration enables Node.js cluster mode, spinning up worker instances
 * across all available CPU cores on your VPS for maximum throughput.
 *
 * Commands:
 *   pm2 start ecosystem.config.js    # Start cluster
 *   pm2 reload ecosystem.config.js   # Zero-downtime restart
 *   pm2 status                       # View active workers
 *   pm2 logs                         # View merged logs
 */

module.exports = {
  apps: [
    {
      name: 'milk-collection-api',
      script: './server.js',
      // 'max' automatically spawns 1 worker process per vCPU core
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      keep_alive: true,
      max_memory_restart: '1G',
      listen_timeout: 10000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        MYSQL_HOST: process.env.MYSQL_HOST || '127.0.0.1',
        MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'rt_scale',
        MYSQL_USER: process.env.MYSQL_USER || 'root',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'mirage',
        MYSQL_PORT: process.env.MYSQL_PORT || 3306,
        // Database pool size per worker process.
        // With 4 workers x 20 pool size = 80 total connections to MySQL.
        MYSQL_POOL_LIMIT: process.env.MYSQL_POOL_LIMIT || 20,
        MYSQL_QUEUE_LIMIT: process.env.MYSQL_QUEUE_LIMIT || 200,
        KEEP_ALIVE_TIMEOUT: 65000,
        HEADERS_TIMEOUT: 66000,
      },
    },
  ],
};
