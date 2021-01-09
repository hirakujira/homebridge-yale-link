import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { YaleLinkPlatformAccessory } from './platformAccessory';
import axios from 'axios';
import fs from 'fs';

export interface BLEDevice {
  name: string;
  deviceId: string;
  extraString: string;
}

export class YaleLinkPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public readonly baseUrl: string = 'https://irevo.app.hura.center:18443/api';
  public accountInfo = {};
  public readonly apiHeader = {
    'Content-type': 'application/json',
    'X-HIT-Version': '1.0',
  };

  private storagePath = '';
  private token = '';
  private terminalId = '';
  private failedTries = 0;
  private debugMode = false;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    this.api.on('didFinishLaunching', async () => {

      this.storagePath = api.user.storagePath() + '/' + 'yalelink_token';

      // Create new token config file or load it if exists
      await this.setupTokenConfig();

      this.terminalId = this.config.terminalId === '' ? 'FFFFFFFFFFFF' : this.config.terminalId as string;
      this.debugMode = this.config.debug !== undefined ? this.config.debug as boolean : false;

      // For login
      this.accountInfo = {
        'app_id': 'com.yale.blen',
        'terminal_id': this.terminalId,
        'sso_token': this.token,
        'app_type': 'ios',
        'language': 'zh-Hant',
        'fcm_token': this.terminalId === '' ? 'FFFFFFFFFFFF' : this.terminalId,
        'user_id': this.config.loginId + '/google',
      };

      const isLogin = await this.loginAccount();

      // If login is not successful, try to get a new token via browser
      if (!isLogin) {
        this.askForNewToken();
        return;
      }

      let needToGetProfile = false;
      const devices = this.config.accessories as Array<BLEDevice>;
      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];

        if (device.deviceId === '' || device.deviceId.toUpperCase() === 'FFFFFFFFFFFF') {
          needToGetProfile = true;
          break;
        }
        // convert UUID to the format which we would use later.
        device.deviceId = device.deviceId.replace(/-/g, '').toUpperCase();
        if (device.deviceId.length !== 12) {
          device.deviceId = device.deviceId.substr(4, 12);
        }
      }
      if (needToGetProfile || this.terminalId === 'FFFFFFFFFFFF') {
        await this.getProfile();
        return;
      }


      const refreshed = await this.refreshToken();
      if (!refreshed) {
        this.askForNewToken();
        return;
      }

      // Discover Yale Link devices
      this.discoverDevices();

      setInterval(() => {
        // update token every 10 minutes after starting, if failed, try again in 10 minutes.
        // becase Google token only lives for 3600 seconds, it's unnecessary to retry when it failed too many times.
        if (this.failedTries < 6) {
          const refreshed = this.refreshToken();

          // reset conter if suceesses
          if (refreshed) {
            this.failedTries = 0;
          } else {
            this.failedTries += 1;
          }
        }
      }, 10 * 60 * 1000);
    });
  }

  async askForNewToken() {
    let request, response, result;

    try {
      request = {
        method: 'GET',
        timeout: 10 * 1000,
        url: this.baseUrl + '/v1/oauth/login?target=default',
        headers: this.apiHeader,
        data: { 'account': this.accountInfo },
      };

      response = await axios(request);
      if (response === undefined) {
        this.log.error('Failed to get Google authentication URL. Please try again');
        return;
      }

      result = response.data;

      // get Google authentication link from response. 
      this.log.info('Google authentication URL: ');
      this.log.warn(result.providers[0].link + '\n');

      // show hint messages
      this.log.info('Please open the link in your web browser, then login with the account which you linked with Yale Link app.');
      this.log.info('After login, open developer tool and search "access_token" in source code. \
The access token should start with "ya29".');
      this.log.info('Or you can paste and run this script to console to show the access token directly:\n');
      this.log.warn('let regex = new RegExp(/access_token\\\\\\" \\: \\\\\\"(.*)\\\\\\",/gi); \
regex.exec(document.getElementsByTagName("script")[0].innerHTML.match(regex))[1];\n');
      this.log.info('Paste your token to "yalelink_token", replace the content if there\'s any.');
      this.log.info('Then restart your homebridge to apply token settings.');

      if (result.error) {
        throw (result);
      }
    } catch (error) {
      error.status = error.response && error.response.status;
      this.log.error('Failed to get Google authentication URL. Error: ' + error.status);
    }
  }

  async loginAccount() {
    this.log.debug('Login account with access token.');

    let request, response, result;
    try {
      request = {
        method: 'PUT',
        timeout: 10 * 1000,
        url: this.baseUrl + '/v1/accounts/login/put',
        headers: this.apiHeader,
        data: { 'account': this.accountInfo },
      };

      response = await axios(request);
      if (response === undefined) {
        this.log.error('Failed to login with SSO token, please try again.');
        return false;
      }

      result = response.data;

      // the result is null when successes
      if (result === null) {
        this.log.debug('Login success.');
        return true;
      } else {
        throw (result);
      }
    } catch (error) {
      error.status = error.response && error.response.status;
      this.log.error('Failed to login with SSO token, please try again. Error: ' + error.status);
    }

    return false;
  }

  async getProfile() {
    this.log.debug('Try to get lastest terminal ID.');

    let request, response, result;
    try {
      request = {
        method: 'POST',
        timeout: 10 * 1000,
        url: this.baseUrl + '/v1/devices/profile/get',
        headers: this.apiHeader,
        data: { 'account': this.accountInfo },
      };

      response = await axios(request);

      if (response === undefined) {
        this.log.error('Failed to get profile, please try again.');
        return false;
      }

      result = response.data;

      if (result.error) {
        this.log.error('Failed to get profile, please try again.');
        throw (result);
      }

      for (let i = 0; i < result.devices.length; i++) {
        const device = result.devices[i];
        this.log.warn('Please add the following DeviceId and TerminalId to your config, and then restart again.');
        this.log.info('Device ' + (i + 1) + ':');
        this.log.info('DeviceId: ' + device.device_id.split('-')[2]);
        this.log.info('TerminalId: ' + device.system_id);
      }
    } catch (error) {
      this.log.error('Failed to get profile: ' + JSON.stringify(error.response.data));
    }
  }

  async refreshToken() {
    this.debug('Refresh auth token via Google.');

    let request, response, result;
    try {
      request = {
        method: 'POST',
        timeout: 10 * 1000,
        url: this.baseUrl + '/v1/oauth/refresh_token',
        headers: this.apiHeader,
        data: { 'account': this.accountInfo },
      };

      this.debug('Old token: ' + JSON.stringify(this.accountInfo));
      response = await axios(request);

      if (response === undefined) {
        this.log.error('Failed to refresh Google authentication, please try again.');
        return false;
      }

      result = response.data;

      if (result.error) {
        this.log.error('Failed to refresh Google authentication, please try again.');
        throw (result);
      }

      // update token
      this.debug('Token refreshed successfully. New token: ' + result.access_token);
      this.token = result.access_token;
      this.accountInfo['sso_token'] = result.access_token;

      // update token in config file
      return this.updateTokenConfig(this.token);

    } catch (error) {
      this.log.error('Access token acquisition via Google authentication failed: ' + JSON.stringify(error.response.data));
    }

    return false;
  }

  discoverDevices() {
    const devices = this.config.accessories ? this.config.accessories : [];

    // Cleanup removed accessories
    for (const existingAccessory of this.accessories) {
      let accessoryFound = false;
      for (const device of (devices as Array<BLEDevice>)) {

        const uuid = this.api.hap.uuid.generate(device.deviceId);
        if (existingAccessory.UUID === uuid) {
          accessoryFound = true;
        }
      }

      if (!accessoryFound) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      }
    }

    for (const device of (devices as Array<BLEDevice>)) {
      // Generate UUID from lock device id
      const uuid = this.api.hap.uuid.generate(device.deviceId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        if (device) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

          // create the accessory handler for the restored accessory
          new YaleLinkPlatformAccessory(this, existingAccessory);

          // update accessory cache with any changes to the accessory details and information
          this.api.updatePlatformAccessories([existingAccessory]);
        }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.deviceId);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.deviceId, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new YaleLinkPlatformAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  setupTokenConfig() {
    if (fs.existsSync(this.storagePath)) {
      try {

        // load token and terminalId from config file
        const data = fs.readFileSync(this.storagePath, 'utf8');
        this.config.ssoToken = data;
        this.token = data;
      } catch (error) {
        this.log.error('Cannot read file from data. Please check content of ' +
          this.storagePath +
          ' ,or remove it to create a new one automatically.');
      }
    } else {
      this.log.info('Cannot found token file, create a new one');

      fs.writeFile(this.storagePath, '', (error) => {
        if (error) {
          this.log.error('Cannot create new file to path: ' + this.storagePath);
        } else {
          this.log.info('Created new file to path: ' + this.storagePath);
        }
      });
    }
  }

  updateTokenConfig(token: string) {
    try {
      fs.writeFileSync(this.storagePath, token, 'utf8');
      this.debug('Token config updated: ' + this.storagePath);

      return true;

    } catch (error) {
      this.log.error('Cannot write file from data. Please check content of ' +
        this.storagePath +
        ' ,or remove it to create a new one automatically.');
    }

    return false;
  }

  debug(message: string) {
    if (this.debugMode) {
      this.log.debug(message);
    }
  }
}
