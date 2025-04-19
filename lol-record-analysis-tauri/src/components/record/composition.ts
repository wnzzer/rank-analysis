import router from "../../router";

export const kdaColor = (kda: number) => {
    if (kda >= 2.6) {
      return '#8BDFB7'
    } else if (kda <= 1.3) {
      return '#BA3F53'
    }
    return '#FFFFFF';
  }
  /**
   * Returns a color based on the number of kills.
   * - Green for 8 or more kills.
   * - Red for 3 or fewer kills.
   * @param {number} kills - The number of kills to evaluate.
   * @returns {string} - The color corresponding to the number of kills.
   */
 export const killsColor = (kills: number) => {
    if (kills >= 8) {
      return '#8BDFB7'
    } else if (kills <= 3) {
      return '#BA3F53'
    }
  }
export  const deathsColor = (deaths: number) => {
    if (deaths >= 8) {
      return '#BA3F53'
    } else if (deaths <= 3) {
      return '#8BDFB7'
    }
  }
export  const assistsColor = (assists: number) => {
    if (assists >= 10) {
      return '#8BDFB7'
    } else if (assists <= 3) {
      return '#BA3F53'
    }
  }
export  const groupRateColor = (groupRate: number) => {
    if (groupRate >= 45) {
      return '#8BDFB7'
    } else if (groupRate <= 15) {
      return '#BA3F53'
    }
  }
  export const healColorAndTaken = (other: number) => {
    if (other >= 25) {
      return '#8BDFB7'
    }
  }

 export const otherColor = (other: number) => {
    if (other >= 25) {
      return '#8BDFB7'
    } else if (other <= 15) {
      return '#BA3F53'
    }
  }
  export const winRateColor = (winRate: number) => {
    if (winRate >= 57) {
      return '#8BDFB7'
    } else if (winRate <= 49) {
      return '#BA3F53'
    }
  }
  export function winRate(wins : number, losses : number) {

    const totalFlexGames = wins + losses
    if (totalFlexGames === 0) {
        return 0; // 或者可以选择返回 null、-1、或者其他你认为合适的值
    }
    return Math.round(wins / totalFlexGames * 100);
  
  }
  

 export function searchSummoner(nameId:string) {
    router.push({
        path: '/Record',
        query: { name: nameId, t: Date.now() }  // 添加动态时间戳作为查询参数
    })
}
  
export const modeOptions = [
  { label: '全部', value: 0, key:0 },
  { label: '单双排', value: 420, key:420 },
  { label: '匹配', value: 430, key:430 },
  { label: '灵活排', value: 440, key:440 },
  { label: '大乱斗', value: 450, key:450 },
  { label: '匹配', value: 490, key:490 },
  { label: '人机', value: 890, key:890 },
  { label: '无限乱斗', value: 900, key: 900 },
  { label: '斗魂竞技场', value: 1700, key:1700 },
  { label: '无限火力', value: 1900, key:1900 },
]