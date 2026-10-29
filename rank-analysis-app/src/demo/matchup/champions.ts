/** 演示资源清单：仅用于开发入口，不进入正式应用数据源。 */
export const DEMO_CHAMPIONS: Record<number, { name: string; alias: string }> = {
  1: { name: '安妮', alias: 'Annie' },
  103: { name: '阿狸', alias: 'Ahri' },
  86: { name: '盖伦', alias: 'Garen' },
  64: { name: '李青', alias: 'LeeSin' },
  222: { name: '金克丝', alias: 'Jinx' },
  412: { name: '锤石', alias: 'Thresh' },
  127: { name: '丽桑卓', alias: 'Lissandra' },
  112: { name: '维克托', alias: 'Viktor' },
  3: { name: '加里奥', alias: 'Galio' },
  7: { name: '乐芙兰', alias: 'Leblanc' },
  84: { name: '阿卡丽', alias: 'Akali' },
  55: { name: '卡特琳娜', alias: 'Katarina' },
  517: { name: '塞拉斯', alias: 'Sylas' },
  61: { name: '奥莉安娜', alias: 'Orianna' },
  134: { name: '辛德拉', alias: 'Syndra' },
  99: { name: '拉克丝', alias: 'Lux' },
  90: { name: '玛尔扎哈', alias: 'Malzahar' },
  13: { name: '瑞兹', alias: 'Ryze' },
  516: { name: '奥恩', alias: 'Ornn' },
  5: { name: '赵信', alias: 'XinZhao' },
  22: { name: '艾希', alias: 'Ashe' },
  89: { name: '蕾欧娜', alias: 'Leona' }
}

/** 获取 Riot 公共头像供无客户端浏览器演示。
 * @param id 英雄 ID。
 * @returns 版本固定的资源 URL；未知英雄返回空。
 */
export function demoIcon(id: number): string {
  const champion = DEMO_CHAMPIONS[id]
  return champion
    ? `https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/${champion.alias}.png`
    : ''
}
