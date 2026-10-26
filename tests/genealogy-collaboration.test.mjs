import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenealogyEvent,
  createGenealogyNotification,
  createProposalDraft,
  transitionProposal
} from "../js/genealogy-collaboration.js";

test("un brouillon fixe l'auteur et conserve le contenu proposé sans toucher aux données officielles", () => {
  const payload = { title: "Acte de naissance", pages: [{ id: "page-1" }] };
  const proposal = createProposalDraft({ id: "proposal-1", type: "source", authorUid: "member-1", targetType: "source", targetId: "source-1", payload });
  payload.pages[0].id = "modifié";
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.authorUid, "member-1");
  assert.equal(proposal.payload.pages[0].id, "page-1");
  assert.equal(Object.isFrozen(proposal.payload.pages[0]), true);
});

test("seul l'auteur peut soumettre, modifier ou annuler un brouillon", () => {
  const draft = createProposalDraft({ id: "p", type: "proof", authorUid: "member", targetType: "proof", targetId: "proof", payload: {} });
  assert.equal(transitionProposal(draft, { to: "pending", actorUid: "member", actorRole: "member" }).status, "pending");
  assert.equal(transitionProposal(draft, { to: "cancelled", actorUid: "member", actorRole: "member" }).status, "cancelled");
  assert.throws(() => transitionProposal(draft, { to: "pending", actorUid: "other", actorRole: "member" }), /auteur/);
  assert.throws(() => transitionProposal(draft, { to: "accepted", actorUid: "member", actorRole: "member" }), /administrateurs/);
});

test("une proposition soumise ne peut être décidée que par un administrateur, avec justification", () => {
  const pending = { id: "p", type: "proof", status: "pending", authorUid: "member", targetType: "proof", targetId: "proof", payload: {} };
  assert.equal(transitionProposal(pending, { to: "accepted", actorUid: "admin", actorRole: "admin", resolutionReason: "Références vérifiées" }).status, "accepted");
  assert.throws(() => transitionProposal(pending, { to: "rejected", actorUid: "admin", actorRole: "admin" }), /resolutionReason/);
  assert.throws(() => transitionProposal({ ...pending, status: "accepted" }, { to: "rejected", actorUid: "admin", actorRole: "admin", resolutionReason: "Correction" }), /attente/);
});

test("les événements et notifications exigent des identifiants, auteurs et objets", () => {
  assert.equal(createGenealogyEvent({ id: "e", eventType: "proof.revised", objectType: "proof", objectId: "p", actorUid: "admin" }).previousVersionId, null);
  assert.equal(createGenealogyNotification({ id: "n", recipientUid: "u", type: "proposal-rejected", objectType: "proposal", objectId: "p", eventId: "e" }).read, false);
  assert.throws(() => createGenealogyEvent({ id: "e", eventType: "invented", objectType: "proof", objectId: "p", actorUid: "admin" }), /non reconnu/);
  assert.throws(() => createGenealogyNotification({ id: "n", recipientUid: "u", type: "proposal-rejected", objectType: "proposal", objectId: "p" }), /eventId/);
});
