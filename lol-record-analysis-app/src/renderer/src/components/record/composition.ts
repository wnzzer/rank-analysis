import router from "@renderer/router";

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
    return '#FFFFFF';
  }
export  const deathsColor = (deaths: number) => {
    if (deaths >= 8) {
      return '#BA3F53'
    } else if (deaths <= 3) {
      return '#8BDFB7'
    }
    return '#FFFFFF';
  }
export  const assistsColor = (assists: number) => {
    if (assists >= 10) {
      return '#8BDFB7'
    } else if (assists <= 3) {
      return '#BA3F53'
    }
    return '#FFFFFF';
  }
export  const groupRateColor = (groupRate: number) => {
    if (groupRate >= 45) {
      return '#8BDFB7'
    } else if (groupRate <= 15) {
      return '#BA3F53'
    }
    return '#FFFFFF';
  }
 export const otherColor = (other: number) => {
    if (other >= 30) {
      return '#8BDFB7'
    } else if (other <= 15) {
      return '#BA3F53'
    }
    return '#FFFFFF';
  }
  export const winRateColor = (winRate: number) => {
    if (winRate >= 57) {
      return '#8BDFB7'
    } else if (winRate <= 49) {
      return '#BA3F53'
    }
    return '#FFFFFF';
  }
  

 export function searchSummoner(nameId:string) {
    router.push({
        path: '/Record',
        query: { name: nameId, t: Date.now() }  // 添加动态时间戳作为查询参数
    })
}
  