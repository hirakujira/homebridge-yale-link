
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


[中文版](./README_zh.md)

# Yale Link Homebridge Plugin

This is a homebridge plugin that add HomeKit compatibility to your Yale Link Bridge devices.

## Hardware Requirement

Yale sales different model of locks and bridges in different countries. This plugin only works for Asian models.

Please make sure your Yale Link Bluetooth Module and Yale Link Bridge are same as the items in the following links.

* [A Yale lock which is compatible with Yale Link](https://www.yaletaiwanstore.com.tw/product_category/yale-link)
* [Yale Link Bluetooth Module](https://www.yalehome.co.in/en/products/products-categories/smart-products/accessories/yale-link-bluetooth-module/)
* [Yale Link Bridge](https://www.yaletaiwanstore.com.tw/products/yale-link-bridge/)

## Installation

After Homebridge has been installed:

`sudo npm i -g homebridge-yale-link@latest`

## Prepairing your lock

I strongly suggeset the lock be set to 'Master Mode' before setup this plugin because only Master Mode can delete specific bluetooth device instead of reset all devices.

1. Install Yale Link app on your iPhone, then pair the lock to your iPhone normally.
2. Login Yale Link with Google Account. This plugin only supports Google Account now.
3. Connect to Yale Link Bridge in the app and make sure that it works. (Can unlock / lock the door with WiFi instead of bluetooth.)
4. Delete the Yale Link App from your iPhone. DO NOT LOGOUT BEFORE YOU DELETE IT.
5. Add the following example config to your Homebridge config. Change `loginId` to your Google Account. Leave `terminalId` and `deviceId` as `FFFFFFFFFFFF` if you don't know the real IDs.
6. Run Homebridge, now you would see an instruction which shows a link to Google authentication URL. Open the link and login with the same Google Account you filled in the config.
7. After login your account, it would show a blank page. Open developer tool in your browser and run this script to console to show the access token directly:
`let regex = new RegExp(/access_token\\\" \: \\\"(.*)\\\",/gi); regex.exec(document.getElementsByTagName("script")[0].innerHTML.match(regex))[1];`
8. Copy the token starts with `ya29.` and paste it to `yalelink_token` file which is in the same directory of `config.json` of Homebridge. Save the file, and then restart Homebridge.
9. After restart, it would show the terminalId and deviceId. Paste them to your config and restart again.
10. Now you can install Yale Link and pair to your lock again on your iPhone. Remember, don't delete the paired device in previous steps or you need to follow this tutorial from 1. again.

## Config

Simple config example:

```
{
    "bridge": {
    ...
    },
    "accessories": [
    ...
    ],
    "platforms": [
    {
        "platform": "YaleLinkPlatform",
        "loginId": "example@gmail.com",
        "isNoOtherTerminal": false,
        "terminalId": "FFFFFFFFFFFF",
        "accessories": [{
            "name": "My Door Lock",
            "deviceId": "FFFFFFFFFFFF"
        }]
    }
    ]
}
```

## Options

| **Attributes** | **Required** | **Usage** | **Default** | **Options** |
|----------------|--------------|-----------|-------------|-------------|
| loginId | **YES** | The account to login Yale Link | 
| isNoOtherTerminal |  | Yale Link Bridge only allows one device to connect it in the same time. So the app must ask the server to give permission everytime, which casues more delay when controlling the lock. If this option set to **true**, then this plugin won't ask for permission everytime and boost the response latency. However, if you use both Yale Link app with bridge (WiFi control) and homebridge, this would cause conflicts and make homebridge plugin not to work. | false | true/false
| terminalId | **YES** | An ID of your device, which is generated randomly when you install Yale Link app | FFFFFFFFFFFF |
| accessories.name | **YES** | Name of the lock | |
| accessories.deviceId | **YES** | An unique ID of the bluetooth module | FFFFFFFFFFFF |