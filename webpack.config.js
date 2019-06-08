const env = process.env.NODE_ENV
const path = require('path');

module.exports = env => {
  console.log(`🛠️  running ${env} Mode using ./webpack/webpack.${env}.js 🛠️`);
  let common = {
    resolve: {
      alias: {
        Appomata: path.resolve(__dirname, 'src/modules/Appomata.js'),
        modules: path.resolve(__dirname, 'src/modules/')
      }
    }
  }
  return Object.assign(require(`./webpack/webpack.${env}.js`), common);
};
