import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { YaleLinkPlatform } from './platform';
import axios from 'axios';

export class DeviceCommand {

  public command;

  constructor(
    private commandCode: string,
    private terminalId: string,
    private deviceId: string,
  ) {
    this.command = [
      {
        'msg': {
          'o': 'w',
          'e': [
            {
              'n': '/100/0/0',
              'sv': this.commandCode,
            },
            {
              'n': '/100/0/2',
              'sv': this.terminalId,
            },
          ],
        },
        'device_id': 'IREVOLOCK-FFFFFFFF0002_BD-' + this.deviceId,
      },
    ];
  }
}

export class YaleLinkPlatformAccessory {
  private service: Service;
  private readonly config;
  private log;
  private targetToLock = true;
  private debugMode = false;
  private currentIsError = false;

  constructor(
    private readonly platform: YaleLinkPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.config = this.platform.config;
    this.log = this.platform.log;
    this.debugMode = this.config.debug !== undefined ? this.config.debug as boolean : false;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yale')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.deviceId);

    // get LockMechanism service if it exists, otherwise creare a new LockMechanism service
    this.service = this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Yale Lock');

    // register handlers for the LockCurrentState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .on('get', this.getLockCurrentState.bind(this));

    // register handlers for the LockTargetState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.LockTargetState)
      .on('set', this.setLockTargetState.bind(this))
      .on('get', this.getLockTargetState.bind(this));

    this.connectToBridge(this.accessory.context.device.deviceId);

    // If Homebridge is the only terminal of Yale lock, then connect to bridge every 10 minutes
    if (this.platform.config.isNoOtherTerminal === true) {
      setInterval(async () => {
        await this.connectToBridge(this.accessory.context.device.deviceId);
      }, 10 * 60 * 1000);
    }
  }

  async getLockCurrentState(callback: CharacteristicGetCallback) {

    // Default to lock
    let isLocked = true;
    this.service.updateCharacteristic(this.platform.Characteristic.LockTargetState, isLocked);

    try {

      // connect to bridge first
      let connect = this.platform.config.isNoOtherTerminal;
      if (connect !== true) {
        connect = await this.connectToBridge(this.accessory.context.device.deviceId);
      }

      if (connect) {

        const status = await this.getLockStatus(this.accessory.context.device.deviceId);
        isLocked = status === this.platform.Characteristic.LockCurrentState.UNSECURED ? false : true;
        this.targetToLock = isLocked;

        this.platform.debug('Get Characteristic LockCurrentState from API: ' + isLocked);
        this.service.updateCharacteristic(this.platform.Characteristic.LockTargetState, isLocked);
      }

    } catch (error) {
      this.log.error('Get Characteristic LockCurrentState from API failed:', error);
    }

    callback(null, isLocked);
  }

  getLockTargetState(callback: CharacteristicGetCallback) {
    this.platform.debug('Get Characteristic lock target ->' + this.targetToLock);
    callback(null, this.targetToLock);
  }

  async setLockTargetState(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    let connect = this.platform.config.isNoOtherTerminal;
    if (connect !== true) {
      connect = await this.connectToBridge(this.accessory.context.device.deviceId);
    }

    if (connect) {
      await this.lockDevice(value, this.accessory.context.device.deviceId);
      this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState).updateValue(value);
      this.platform.debug('Set Characteristic lock target ->' + value);
      this.targetToLock = value as boolean;

      // update status automatically after clicking accessory
      setTimeout(() => {
        this.service.updateCharacteristic(this.platform.Characteristic.LockCurrentState,
          this.platform.Characteristic.LockCurrentState.SECURED);
        this.service.updateCharacteristic(this.platform.Characteristic.LockTargetState,
          this.platform.Characteristic.LockTargetState.SECURED);
      }, 10 * 1000);

      // Prevent bug on other devices.
      setTimeout(() => {
        this.targetToLock = true;
      }, 1000);
    }

    callback(null);
  }

  async connectToBridge(deviceId: string) {

    // generate random hex string as frame
    const randomHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
    const deviceCommand = new DeviceCommand('74A0' + randomHex(2) + '02B11000', this.config.terminalId, deviceId);

    let request, response, result;

    try {
      request = {
        method: 'POST',
        timeout: 10 * 1000,
        url: this.platform.baseUrl + '/v1/devices/control/set',
        headers: this.platform.apiHeader,
        data: {
          'account': this.platform.accountInfo,
          'devices': deviceCommand.command,
        },
      };

      response = await axios(request);
      if (response === undefined) {
        this.log.error('Failed to connect to bridge, please try again.');
        return false;
      }

      result = response.data;
      if (result.error) {
        throw (result);
      }

      if (this.currentIsError === true || this.debugMode === true) {
        this.log.debug('Connect to bridge succfully');
        this.currentIsError = false;
      }

      return true;
    } catch (error) {
      
      this.currentIsError = true;
      const error_msg = error['message'] && this.debugMode === false ? error['message'] : JSON.stringify(error);
      this.log.error('Failed to connect to bridge: ' + error_msg);
    }

    return false;
  }

  async getLockStatus(deviceId: string) {

    // generate random hex string as frame
    const randomHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
    const deviceCommand = new DeviceCommand('11A0' + randomHex(2) + '0000', this.config.terminalId, deviceId);

    let status = this.platform.Characteristic.LockCurrentState.UNKNOWN;
    let request, response, result;

    try {
      request = {
        method: 'POST',
        timeout: 10 * 1000,
        url: this.platform.baseUrl + '/v1/devices/control/set',
        headers: this.platform.apiHeader,
        data: {
          'account': this.platform.accountInfo,
          'devices': deviceCommand.command,
        },
      };

      response = await axios(request);
      if (response === undefined) {
        this.log.error('Failed to get lock status, please try again.');
        return false;
      }

      result = response.data;
      if (result.error) {
        this.log.error('Failed to get lock status, please try again.');
        throw (result);
      } else {
        for (const device of result.devices) {
          const e = device.msg.e;

          if (e[1].sv === this.config.terminalId) {
            const code = e[0].sv.substring(8, 10);
            if (code === 'FF' || code === '12') { //locked
              status = this.platform.Characteristic.LockCurrentState.SECURED;
            } else if (code === '00') { //unlock
              status = this.platform.Characteristic.LockCurrentState.UNSECURED;
            }
          }
        }
      }

      
      if (this.currentIsError === true || this.debugMode === true) {
        this.platform.debug('Lock status: ' + status);
        this.currentIsError = false;
      }
      
      return status;

    } catch (error) {
      this.currentIsError = true;
      const error_msg = error['message'] && this.debugMode === false ? error['message'] : JSON.stringify(error);
      this.log.error('Failed to get lock status: ' + error_msg);
    }

    return status;
  }

  async lockDevice(lockState, deviceId: string) {

    // 00 = unlock, ff = lock
    const opCode = lockState === this.platform.Characteristic.LockTargetState.UNSECURED ? '00' : 'ff';

    const randomHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
    const deviceCommand = new DeviceCommand('10A0' + randomHex(2) + '01' + opCode + '00', this.config.terminalId, deviceId);

    let request, response, result;
    try {
      request = {
        method: 'POST',
        timeout: 10 * 1000,
        url: this.platform.baseUrl + '/v1/devices/control/set',
        headers: this.platform.apiHeader,
        data: {
          'account': this.platform.accountInfo,
          'devices': deviceCommand.command,
        },
      };

      response = await axios(request);
      if (response === undefined) {
        this.log.error('Failed to control device, please try again.');
        return false;
      }

      result = response.data;
      if (result.error) {
        throw (result);
      }

      const status = lockState === this.platform.Characteristic.LockTargetState.UNSECURED ? 'unlock' : 'lock';
      this.platform.debug('Set device to ' + status + ' successfully');
      return true;

    } catch (error) {
      this.log.error('Failed to control device: ' + JSON.stringify(error));
    }

    return false;
  }
}
