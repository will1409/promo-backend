module.exports = {
  apps: [
    {
      name: "pegueapromo-api",
      script: "./lib/index.js",
      instances: 1, // Baileys (WhatsApp) prefere rodar em 1 instância apenas para evitar conflitos de sessão sqlite
      autorestart: true,
      watch: false,
      node_args: "--max-old-space-size=14000",
      max_memory_restart: "14G", // Se ultrapassar 14GB de RAM, restarta o processo para liberar memória (vazamentos do Playwright/Baileys)
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
