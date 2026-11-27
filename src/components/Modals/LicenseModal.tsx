import React from 'react';
import { ExternalLink, InfoModal, INFO_SECTION_TITLE, INFO_TEXT } from './InfoModal';
import { PROJECT, suggestedCredit } from '../../config/projectCredit';

/** One data source: what it gave Qatalogue, and on what terms. */
const Source: React.FC<{ name: string; href: string; terms: React.ReactNode; children: React.ReactNode }> = ({ name, href, terms, children }) => (
  <li className={INFO_TEXT}>
    <ExternalLink href={href}>{name}</ExternalLink>: {children} <span className="whitespace-nowrap">({terms})</span>
  </li>
);

const CC0 = <ExternalLink href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</ExternalLink>;

/**
 * What may be done with Qatalogue's code and data (LICENSE, LICENSE-DATA.md), in plain words, and where the data came
 * from. Keep the sources in step with the pipeline: a new source may bring terms of its own.
 */
export const LicenseModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <InfoModal title="License" onClose={onClose}>
    <section>
      <h3 className={INFO_SECTION_TITLE}>Code · MIT License</h3>
      <p className={INFO_TEXT}>
        Qatalogue's code may be used, copied, changed and shared for any purpose, commercial use included, as long as its
        copyright and license notice stay with it. <ExternalLink href="https://opensource.org/license/mit">The MIT License</ExternalLink>.
        The fonts it serves are under the <ExternalLink href="https://openfontlicense.org">SIL Open Font License</ExternalLink>.
      </p>
    </section>
    <section>
      <h3 className={INFO_SECTION_TITLE}>Data and content · CC BY 4.0</h3>
      <p className={`${INFO_TEXT} mb-3`}>
        Qatalogue's own work (the scores, lists, networks and charts, exported images and tables included, the topic
        taxonomy and the methodology) may be shared and adapted for any purpose, as long as you credit Qatalogue, link to
        the license and say whether you made changes.{' '}
        <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>
      </p>
      <p className={`${INFO_TEXT} mb-3`}>A suggested credit:</p>
      <p className="m-0 border-l-2 border-outline bg-surface-variant px-4 py-3 text-sm italic leading-relaxed text-on-surface-variant">
        {suggestedCredit()}
      </p>
    </section>
    <section>
      <h3 className={INFO_SECTION_TITLE}>Logo · All rights reserved</h3>
      <p className={INFO_TEXT}>
        The Qatalogue logo and favicon are copyright {PROJECT.creator}, all rights reserved, and are not covered by the
        MIT or CC BY 4.0 licenses.
      </p>
    </section>
    <section>
      <h3 className={INFO_SECTION_TITLE}>Sources</h3>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-outline">
        <Source name="OpenAlex" href="https://openalex.org" terms={CC0}>works, authors, institutions, and topics</Source>
        <Source name="ROR" href="https://ror.org" terms={CC0}>institution identifiers and locations</Source>
        <Source name="arXiv" href="https://arxiv.org" terms={<>{CC0} metadata</>}>abstracts and subject categories</Source>
      </ul>
      <p className={`${INFO_TEXT} mt-3`}>
        Article-type metadata from{' '}
        <ExternalLink href="https://dev.springernature.com/">Springer Nature</ExternalLink> and{' '}
        <ExternalLink href="https://harvest.aps.org/docs/harvest-api">APS</ExternalLink> is used during build-time
        filtering to exclude non-research items and is not included in the served database.
      </p>
      <p className={`${INFO_TEXT} mt-2`}>
        Abstracts are not redistributed; only a contentless search index and embedding vectors are served. Upstream
        records remain under their respective terms, and attribution does not imply endorsement.
      </p>
    </section>
  </InfoModal>
);

export default LicenseModal;
