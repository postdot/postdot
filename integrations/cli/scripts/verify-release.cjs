const { verifyPackage } = require('../../scripts/verify-release.cjs')
verifyPackage(require('node:path').resolve(__dirname, '..'))
