# Claude 中转测试白名单

Oracle 配置文件为 `/etc/claude-relay.env`，由 systemd 加载。白名单只豁免地区限制，客户端认证、模型限制和额度限制继续生效。

## 手动维护

```sh
ssh oracle
sudoedit /etc/claude-relay.env
```

修改以下两项，多个值用逗号分隔，留空表示不配置该类白名单：

```ini
ALLOWED_DEVICE_IDS=设备ID1,设备ID2
ALLOWED_IPS=203.0.113.1,203.0.113.2
```

设备 ID 可从客户端「关于」页复制。设备 ID 或出口 IP 任意一项命中即豁免地区限制。删除某项后，该设备仍可能因 IP 白名单或所在地区受到支持而可用。

保存后重启服务使配置生效，无需重新部署代码或发布客户端：

```sh
sudo systemctl restart claude-relay
sudo systemctl is-active claude-relay
```

客户端在设置页点击「重新检测」刷新结果。设备白名单需要支持 `X-Device-ID` 请求头的客户端；旧版本仍可使用 IP 白名单。

设备 ID 是本地保存的匿名标识，清除后会改变，也能被复制；仅供测试放行，不替代 `RELAY_TOKEN` 鉴权。不要覆盖文件中现有的 API Key 或 token。

## 回归测试

安装 `requirements.txt` 后，在仓库根目录执行：

```sh
python3 -m unittest discover -s relay/claude-relay
```

## Oracle Fast 模式

在同一个 `/etc/claude-relay.env` 文件中设置：

```ini
FAST_MODE=1
```

`1` 开启、`0` 关闭，缺省关闭。修改后执行 `sudo systemctl restart claude-relay`，客户端无需修改或重新编译。

仅对 `claude-opus-5-5` 发送 `speed: "fast"`，Sonnet/Haiku 保持原行为。Fast 模式提升输出速度，不保证缩短首字等待时间，按官方 Fast 费率计费（也适用于用户自带 Key）。参见 [官方文档](https://platform.claude.com/docs/en/build-with-claude/fast-mode)。
