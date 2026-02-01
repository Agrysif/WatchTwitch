// Twitch API Client - централизованная работа с API
class TwitchAPIClient {
  constructor() {
    this.baseURL = 'https://gql.twitch.tv/gql';
    this.clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  }

  /**
   * Базовый метод для GraphQL запросов
   */
  async graphQLRequest(query, variables = {}) {
    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('GraphQL request failed:', error);
      throw error;
    }
  }

  /**
   * Получить топ категорий для дропов
   */
  async getDropsCategories() {
    const query = `
      query {
        dropsHighlightedGames(first: 100) {
          edges {
            node {
              id
              displayName
              boxArtURL
            }
          }
        }
      }
    `;
    
    const result = await this.graphQLRequest(query);
    return result.data?.dropsHighlightedGames?.edges?.map(edge => ({
      id: edge.node.id,
      name: edge.node.displayName,
      imageUrl: edge.node.boxArtURL?.replace('{width}', '285').replace('{height}', '380')
    })) || [];
  }

  /**
   * Получить активные кампании с дропами
   */
  async getDropsCampaigns() {
    const query = `
      query ViewerDropsDashboard {
        currentUser {
          dropCampaigns {
            id
            name
            status
            startAt
            endAt
            game {
              id
              displayName
              boxArtURL
            }
            timeBasedDrops {
              id
              name
              startAt
              endAt
              requiredMinutesWatched
              benefitEdges {
                benefit {
                  id
                  name
                  imageAssetURL
                }
              }
            }
          }
        }
      }
    `;
    
    const result = await this.graphQLRequest(query);
    return result.data?.currentUser?.dropCampaigns || [];
  }

  /**
   * Получить прогресс дропов пользователя
   */
  async getDropsProgress() {
    const query = `
      query DropCurrentSessionContext {
        currentUser {
          dropCurrentSession {
            dropID
            requiredMinutesWatched
            currentMinutesWatched
          }
        }
      }
    `;
    
    const result = await this.graphQLRequest(query);
    return result.data?.currentUser?.dropCurrentSession;
  }

  /**
   * Получить инвентарь с полученными дропами
   */
  async getDropsInventory() {
    const query = `
      query DropsInventory {
        currentUser {
          inventory {
            dropCampaignsInProgress {
              id
              name
              game {
                id
                displayName
                boxArtURL
              }
              timeBasedDrops {
                id
                name
                requiredMinutesWatched
                self {
                  dropInstanceID
                  currentMinutesWatched
                  isClaimed
                }
                benefitEdges {
                  benefit {
                    id
                    name
                    imageAssetURL
                  }
                }
              }
            }
            gameEventDrops {
              id
              name
              imageAssetURL
              isClaimed
            }
          }
        }
      }
    `;
    
    const result = await this.graphQLRequest(query);
    return result.data?.currentUser?.inventory;
  }

  /**
   * Получить дропы (claim)
   */
  async claimDrop(dropInstanceID) {
    const query = `
      mutation ClaimDrop($input: ClaimDropRewardsInput!) {
        claimDropRewards(input: $input) {
          status
          errors {
            code
            message
          }
        }
      }
    `;
    
    const variables = {
      input: { dropInstanceID }
    };
    
    const result = await this.graphQLRequest(query, variables);
    return result.data?.claimDropRewards;
  }

  /**
   * Поиск стримов по категории
   */
  async searchStreams(categoryId, limit = 30) {
    const query = `
      query SearchStreams($categoryId: ID!, $limit: Int!) {
        game(id: $categoryId) {
          streams(first: $limit, options: { sort: VIEWER_COUNT }) {
            edges {
              node {
                id
                broadcaster {
                  id
                  login
                  displayName
                  profileImageURL(width: 70)
                }
                viewersCount
                previewImageURL(width: 440, height: 248)
                title
                game {
                  displayName
                }
              }
            }
          }
        }
      }
    `;
    
    const variables = { categoryId, limit };
    const result = await this.graphQLRequest(query, variables);
    return result.data?.game?.streams?.edges?.map(edge => edge.node) || [];
  }

  /**
   * Получить информацию о стриме
   */
  async getStreamInfo(channelLogin) {
    const query = `
      query StreamInfo($login: String!) {
        user(login: $login) {
          id
          login
          displayName
          stream {
            id
            title
            viewersCount
            createdAt
            game {
              id
              displayName
            }
          }
        }
      }
    `;
    
    const variables = { login: channelLogin };
    const result = await this.graphQLRequest(query, variables);
    return result.data?.user;
  }

  /**
   * Получить баллы канала
   */
  async getChannelPoints(channelId) {
    const query = `
      query ChannelPointsContext($channelID: ID!) {
        community(id: $channelID) {
          id
          channel {
            self {
              communityPoints {
                balance
                availableClaimTotal
              }
            }
          }
        }
      }
    `;
    
    const variables = { channelID: channelId };
    const result = await this.graphQLRequest(query, variables);
    return result.data?.community?.channel?.self?.communityPoints;
  }
}

// Экспорт синглтона
window.TwitchAPI = window.TwitchAPI || new TwitchAPIClient();
