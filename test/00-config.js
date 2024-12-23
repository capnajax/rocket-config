'use strict';

import { sep } from 'node:path';

import TestBattery from 'test-battery';

import Config from '../build/index.js';

const CONFIG_ROOT = 'test/test-data';
function cf(name) {
  return `${CONFIG_ROOT}${sep}${name}`;
}

const defaultConfig = {
  moreconfig: {defaultKey: 'defaultValue'}
};

describe('config', async () => {
  it ('should load config files', (done) => {

    (async () => {
      const test = new TestBattery('Config');
      const config = new Config(defaultConfig, 
        cf('test-config1.yaml'), cf('test-config2.toml'));

      test.test('Config should be false until ready')
        .value(config.isReady).is.false;

      let isThrown = false;
      try {
        config.get('server');
      } catch (e) {
        isThrown = true;
      }
      test.test('Config should throw an error when not ready')
        .value(isThrown).is.true;

      await config.loadConfigs();
      
      test.test('Config.ready should be true when ready')
        .value(config.isReady).is.true;

      test.test('Config default values should be set')
        .value(config.get('moreconfig.defaultKey'))
        .value('defaultValue').are.equal;
      test.test('Config should load non-overrided values from the first ' +
        'non-default config file')
        .value(config.get('server.host'))
        .value('localhost').are.equal;
      test.test('Config should load an array 1')
        .value(config.get('server.endpoints'))
        .is.array;
      test.test('Config should load an array 2')
        .value(config.get('server.endpoints'))
        .is.array;
      test.endIfErrors();
      test.test('Config should load an array 3')
        .value((config.get('server.endpoints'))?.length)
        .value(2).are.equal;
      test.endIfErrors();
      test.test('Config should load an array 4')
        .value(
          (config.get('server.endpoints')[1])?.method)
        .value('POST').are.equal;
      
      test.test('Overridden values in the second config file should be loaded')
        .value(config.get('database.host'))
        .value('another.example.com').are.equal;
      test.test('New values in the second config file should be loaded')
        .value(config.get('moreconfig.key2'))
        .value('value2').are.equal;

      await config.loadConfigs();

      isThrown = false;
      try {
        config.get('server');
      } catch (e) {
        isThrown = true;
      }
      test.test('Config should not throw an error when it is ready')
        .value(isThrown).is.false;
      
      await config.addSource(cf('test-config3.js'));

      test.test('Overridden values in the third config file should be loaded')
        .value(config.get('server'))
        .value('host3').are.equal;
      test.test('New values in the third config file should be loaded')
        .value(config.get('debug')).is.true;

      await config.removeSource(config.sources[2]);

      test.test('Removed values from the second config file should be removed')
        .value(config.get('database.host'))
        .value('db.example.com').are.equal;

      test.done(done);
    })();
  });
  it ('Global config', (done) => {
    (async () => {
      const test = new TestBattery('Config');

      let thrown = false;
      try {
        Config.c.get('moreconfig.defaultKey');
      } catch (e) {
        thrown = true;
      }
      test.test('Global config should throw an error when not ready')
        .value(thrown).is.true;
      
      await Config.init(defaultConfig);
      
      test.test('Global config should be ready after initConfig')
        .value(Config.c.isReady).is.true;
      
      test.test('Global config should get an accurate value')
        .value(Config.c.get('moreconfig.defaultKey'))
        .value('defaultValue').are.equal;
      
      test.done(done);
    })();
  });
});
