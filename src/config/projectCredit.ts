/** Project-level attribution and repository metadata. */
export const PROJECT = {
  name: 'Qatalogue',
  description: 'an open bibliometric explorer for quantum information science and technology',
  creator: 'Shadnan Azwad Khan',
  creatorUrl: 'https://orcid.org/0000-0003-2769-6856',
  /** Default public repository URL. */
  repositoryUrl: 'https://github.com/shadwad/qatalogue',
} as const;

/** Suggested CC BY 4.0 credit string. */
export const suggestedCredit = (): string =>
  `${PROJECT.name}, ${PROJECT.description}, by ${PROJECT.creator}. Data from OpenAlex, ROR and arXiv. Licensed under CC BY 4.0.`;
